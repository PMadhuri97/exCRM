"""A purchase order with one invoice, for a test that hands a deal over.

Since build prompt chunk 2 a deal is not handed over without its PO and at
least one invoice (``DealService._handover_blocked_reason``). A test about the
handover itself — its lock, its snapshot, its event — needs that paperwork in
place without caring what it says; this records it through the real service, as
an operator would.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from app.modules.onboarding.application.purchase_order_service import PurchaseOrderService
from app.platform.database import services as db_services

#: The same order an API-driven test sends.
PO_BODY = {
    "po_number": "PO-2026-001",
    "po_date": "2026-09-01",
    "currency": "USD",
    "total_amount": "125000.00",
}
INVOICE_BODY = {"invoice_number": "INV-001", "invoice_date": "2026-09-05", "amount": "125000.00"}


async def add_paperwork(deal_id: uuid.UUID) -> None:
    """Give ``deal_id`` a purchase order and one invoice for its full amount."""
    async with db_services.AsyncSessionLocal() as db:
        service = PurchaseOrderService(db)
        await service.set_purchase_order(
            deal_id,
            po_number=PO_BODY["po_number"],
            po_date=date(2026, 9, 1),
            currency="USD",
            total_amount=Decimal(PO_BODY["total_amount"]),
            payment_terms=None,
            source_document_id=None,
            actor_id="test-fixture",
        )
        await service.add_invoice(
            deal_id,
            invoice_number=INVOICE_BODY["invoice_number"],
            invoice_date=date(2026, 9, 5),
            due_date=None,
            amount=Decimal(INVOICE_BODY["amount"]),
            currency=None,
            source_document_id=None,
            actor_id="test-fixture",
        )


__all__ = ["INVOICE_BODY", "PO_BODY", "add_paperwork"]
