"""A deal's purchase order and its invoices — build prompt chunk 2.

The structure (settled 30 September 2026): one deal (``Deal``) → exactly one
purchase order → one or more invoices. "At least one invoice" is a handover rule,
enforced by ``DealService``'s guard; here a PO with no invoices yet is legal.

**One transaction per operation**, as in ``DealService``: lock the deal, check
everything, write, record a ``deal`` history row through ``HistoryService`` (which
flushes and never commits), commit once. A refused write leaves nothing behind.

**Closed deals are frozen.** Nothing on a ``HANDED_OVER`` or ``WITHDRAWN``
deal changes: what the lending team was given, and what was decided against,
must not be editable afterwards — the same rule the buyer and the documents keep.

**Who** may write is the route's (``purchase_order_router.py``); **what** may be
written is this service's.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.onboarding.application.document_extraction import DocumentKind, suggest_fields
from app.modules.onboarding.application.history_service import HistoryService
from app.modules.onboarding.domain.entities.crm_document import CrmDocument
from app.modules.onboarding.domain.entities.deal import Deal
from app.modules.onboarding.domain.entities.purchase_order import Invoice, PurchaseOrder
from app.modules.onboarding.domain.purchase_order_views import (
    ExtractedFields,
    InvoiceView,
    PurchaseOrderView,
)
from app.modules.onboarding.exceptions import (
    DealNotFoundError,
    DealTerminalError,
    InvoiceCurrencyMismatchError,
    InvoiceNotFoundError,
    InvoiceNumberTakenError,
    PurchaseOrderCurrencyLockedError,
    PurchaseOrderNotFoundError,
    SourceDocumentNotOnDealError,
)
from app.modules.onboarding.infrastructure.repositories.deal_repository import DealRepository
from app.shared.exceptions import ValidationError

_HISTORY_DIMENSION = "deal"
_SOURCE = "purchase_order_service"


class PurchaseOrderService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db
        self._deals = DealRepository(db)
        self._history = HistoryService(db)

    # ── Read ─────────────────────────────────────────────────────────────────

    async def get(self, deal_id: uuid.UUID) -> PurchaseOrderView | None:
        """The deal's PO and invoices, or ``None`` if no PO is recorded yet."""
        if await self._deals.get_by_id(deal_id) is None:
            raise DealNotFoundError(deal_id)
        po = await self._po_for(deal_id)
        return _view(po) if po is not None else None

    async def suggest_from_document(
        self, deal_id: uuid.UUID, document_id: uuid.UUID, kind: DocumentKind
    ) -> ExtractedFields:
        """What the configured extractor reads from one of this deal's documents
        — suggestions only. With no extractor configured, an empty suggestion."""
        if await self._deals.get_by_id(deal_id) is None:
            raise DealNotFoundError(deal_id)
        document = await self._document_on_deal(deal_id, document_id)
        if document.scan_status.value != "AVAILABLE":
            raise ValidationError("the document has not been scanned clean yet")
        return await suggest_fields(storage_key=document.storage_key, kind=kind)

    # ── Write ────────────────────────────────────────────────────────────────

    async def set_purchase_order(
        self,
        deal_id: uuid.UUID,
        *,
        po_number: str,
        po_date: date,
        currency: str,
        total_amount: Decimal,
        payment_terms: str | None,
        source_document_id: uuid.UUID | None,
        actor_id: str | None,
    ) -> PurchaseOrderView:
        """Record the deal's PO, or correct the one recorded — one per deal,
        so this is an upsert, not an add."""
        deal = await self._open_deal(deal_id)
        number = _required(po_number, "a purchase order needs a number")
        currency = _currency(currency)
        if source_document_id is not None:
            await self._document_on_deal(deal_id, source_document_id)

        po = await self._po_for(deal_id)
        created = po is None
        if po is None:
            po = PurchaseOrder(deal_id=deal_id)
            self._db.add(po)
        elif po.currency != currency and po.invoices:
            raise PurchaseOrderCurrencyLockedError(current=po.currency, requested=currency)

        changed = [
            name
            for name, value in (
                ("po_number", number),
                ("po_date", po_date),
                ("currency", currency),
                ("total_amount", total_amount),
                ("payment_terms", _optional(payment_terms)),
                ("source_document_id", source_document_id),
            )
            if created or getattr(po, name) != value
        ]
        po.po_number = number
        po.po_date = po_date
        po.currency = currency
        po.total_amount = total_amount
        po.payment_terms = _optional(payment_terms)
        po.source_document_id = source_document_id
        await self._db.flush()

        await self._record(
            deal,
            actor_id,
            event_type="purchase_order_recorded" if created else "purchase_order_changed",
            details={"po_number": number, "changed": changed},
        )
        await self._db.commit()
        return _view(await self._reload(deal_id))

    async def add_invoice(
        self,
        deal_id: uuid.UUID,
        *,
        invoice_number: str,
        invoice_date: date,
        due_date: date | None,
        amount: Decimal,
        currency: str | None,
        source_document_id: uuid.UUID | None,
        actor_id: str | None,
    ) -> PurchaseOrderView:
        deal = await self._open_deal(deal_id)
        po = await self._po_for(deal_id)
        if po is None:
            raise PurchaseOrderNotFoundError(deal_id)
        number = _required(invoice_number, "an invoice needs a number")
        currency = self._invoice_currency(po, currency)
        _check_due(invoice_date, due_date)
        if any(existing.invoice_number == number for existing in po.invoices):
            raise InvoiceNumberTakenError(number)
        if source_document_id is not None:
            await self._document_on_deal(deal_id, source_document_id)

        po.invoices.append(
            Invoice(
                invoice_number=number,
                invoice_date=invoice_date,
                due_date=due_date,
                currency=currency,
                amount=amount,
                source_document_id=source_document_id,
            )
        )
        await self._db.flush()
        await self._record(
            deal,
            actor_id,
            event_type="invoice_added",
            details={"invoice_number": number, "amount": str(amount), "currency": currency},
        )
        await self._db.commit()
        return _view(await self._reload(deal_id))

    async def update_invoice(
        self,
        deal_id: uuid.UUID,
        invoice_id: uuid.UUID,
        *,
        invoice_number: str,
        invoice_date: date,
        due_date: date | None,
        amount: Decimal,
        currency: str | None,
        source_document_id: uuid.UUID | None,
        actor_id: str | None,
    ) -> PurchaseOrderView:
        deal = await self._open_deal(deal_id)
        po = await self._po_for(deal_id)
        if po is None:
            raise PurchaseOrderNotFoundError(deal_id)
        invoice = next((i for i in po.invoices if i.id == invoice_id), None)
        if invoice is None:
            raise InvoiceNotFoundError(invoice_id)
        number = _required(invoice_number, "an invoice needs a number")
        currency = self._invoice_currency(po, currency)
        _check_due(invoice_date, due_date)
        if any(i.invoice_number == number and i.id != invoice_id for i in po.invoices):
            raise InvoiceNumberTakenError(number)
        if source_document_id is not None:
            await self._document_on_deal(deal_id, source_document_id)

        changed = [
            name
            for name, value in (
                ("invoice_number", number),
                ("invoice_date", invoice_date),
                ("due_date", due_date),
                ("amount", amount),
                ("source_document_id", source_document_id),
            )
            if getattr(invoice, name) != value
        ]
        invoice.invoice_number = number
        invoice.invoice_date = invoice_date
        invoice.due_date = due_date
        invoice.currency = currency
        invoice.amount = amount
        invoice.source_document_id = source_document_id
        await self._db.flush()
        await self._record(
            deal,
            actor_id,
            event_type="invoice_changed",
            details={"invoice_number": number, "changed": changed},
        )
        await self._db.commit()
        return _view(await self._reload(deal_id))

    async def remove_invoice(
        self, deal_id: uuid.UUID, invoice_id: uuid.UUID, *, actor_id: str | None
    ) -> PurchaseOrderView:
        deal = await self._open_deal(deal_id)
        po = await self._po_for(deal_id)
        if po is None:
            raise PurchaseOrderNotFoundError(deal_id)
        invoice = next((i for i in po.invoices if i.id == invoice_id), None)
        if invoice is None:
            raise InvoiceNotFoundError(invoice_id)
        number = invoice.invoice_number
        po.invoices.remove(invoice)
        await self._db.flush()
        await self._record(
            deal,
            actor_id,
            event_type="invoice_removed",
            details={"invoice_number": number},
        )
        await self._db.commit()
        return _view(await self._reload(deal_id))

    # ── Internals ────────────────────────────────────────────────────────────

    async def _open_deal(self, deal_id: uuid.UUID) -> Deal:
        """The deal, locked, and refused if it is closed."""
        deal = await self._deals.lock_by_id(deal_id)
        if deal is None:
            raise DealNotFoundError(deal_id)
        if deal.stage.is_terminal:
            raise DealTerminalError(deal_id, deal.stage.value)
        return deal

    async def _po_for(self, deal_id: uuid.UUID) -> PurchaseOrder | None:
        return await self._db.scalar(select(PurchaseOrder).where(PurchaseOrder.deal_id == deal_id))

    async def _reload(self, deal_id: uuid.UUID) -> PurchaseOrder:
        po = await self._db.scalar(
            select(PurchaseOrder)
            .where(PurchaseOrder.deal_id == deal_id)
            .execution_options(populate_existing=True)
        )
        assert po is not None
        return po

    async def _document_on_deal(self, deal_id: uuid.UUID, document_id: uuid.UUID) -> CrmDocument:
        document = await self._db.scalar(
            select(CrmDocument).where(CrmDocument.id == document_id, CrmDocument.deal_id == deal_id)
        )
        if document is None:
            raise SourceDocumentNotOnDealError(document_id)
        return document

    @staticmethod
    def _invoice_currency(po: PurchaseOrder, currency: str | None) -> str:
        """An invoice is in its PO's currency; one sent in another is refused."""
        if currency is None:
            return po.currency
        currency = _currency(currency)
        if currency != po.currency:
            raise InvoiceCurrencyMismatchError(invoice_currency=currency, po_currency=po.currency)
        return currency

    async def _record(
        self, deal: Deal, actor_id: str | None, *, event_type: str, details: dict
    ) -> None:
        await self._history.record(
            deal.company_id,
            dimension=_HISTORY_DIMENSION,
            deal_id=deal.id,
            from_value=deal.stage.value,
            to_value=deal.stage.value,
            actor_id=actor_id,
            source=_SOURCE,
            event_type=event_type,
            details=details,
        )


def _view(po: PurchaseOrder) -> PurchaseOrderView:
    invoices = tuple(
        InvoiceView(
            id=i.id,
            purchase_order_id=i.purchase_order_id,
            invoice_number=i.invoice_number,
            invoice_date=i.invoice_date,
            due_date=i.due_date,
            currency=i.currency,
            amount=i.amount,
            source_document_id=i.source_document_id,
            created_at=i.created_at,
            updated_at=i.updated_at,
        )
        for i in po.invoices
    )
    invoiced = sum((i.amount for i in invoices), Decimal("0"))
    return PurchaseOrderView(
        id=po.id,
        deal_id=po.deal_id,
        po_number=po.po_number,
        po_date=po.po_date,
        currency=po.currency,
        total_amount=po.total_amount,
        payment_terms=po.payment_terms,
        source_document_id=po.source_document_id,
        invoices=invoices,
        invoiced_amount=invoiced,
        uninvoiced_amount=po.total_amount - invoiced,
        created_at=po.created_at,
        updated_at=po.updated_at,
    )


def _required(value: str, message: str) -> str:
    cleaned = (value or "").strip()
    if not cleaned:
        raise ValidationError(message)
    return cleaned


def _optional(value: str | None) -> str | None:
    cleaned = (value or "").strip()
    return cleaned or None


def _currency(value: str) -> str:
    cleaned = (value or "").strip().upper()
    if len(cleaned) != 3 or not cleaned.isalpha():
        raise ValidationError("a currency is a three-letter ISO 4217 code, such as USD or INR")
    return cleaned


def _check_due(invoice_date: date, due_date: date | None) -> None:
    if due_date is not None and due_date < invoice_date:
        raise ValidationError("an invoice cannot fall due before it was issued")


__all__ = ["PurchaseOrderService"]
