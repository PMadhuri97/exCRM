"""``PurchaseOrder`` and ``Invoice`` — what a deal is backed by (build prompt
chunk 2; migration ``onboarding_0023_po_invoice``).

A deal (a ``Deal``) has **exactly one** purchase order, and the PO **one or
more** invoices: exporters split one order into several invoices for tax reasons.
"One or more" is enforced where it matters — a handover needs at least one — and
not on the table, because a PO with no invoices yet is a normal state while the
paperwork is gathered.

These are the documents the verification phase will compare (the PO against its
invoices, the eBL, the bank statements — Centrex §11's cross-document matching),
so their numbers, dates and amounts are columns, not free text. Money is
``NUMERIC(18, 2)`` and a ``Decimal`` in Python, never a float. Each row may point
at the uploaded document it was read from (``source_document_id``); whether a
machine or a person read it is not recorded here — the person who saved it is,
in the deal's history.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.platform.database.models import AnerModel

SCHEMA = "onboarding"


class PurchaseOrder(AnerModel):
    __tablename__ = "purchase_order"
    __table_args__ = (
        UniqueConstraint("deal_id", name="uq_purchase_order_deal_id"),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="ck_purchase_order_currency_iso"),
        CheckConstraint("total_amount > 0", name="ck_purchase_order_total_positive"),
        CheckConstraint("btrim(po_number) <> ''", name="ck_purchase_order_number_present"),
        {"schema": SCHEMA},
    )

    deal_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(f"{SCHEMA}.deal.id", name="fk_purchase_order_deal_id", ondelete="CASCADE"),
        nullable=False,
    )
    po_number: Mapped[str] = mapped_column(String(100), nullable=False)
    po_date: Mapped[date] = mapped_column(Date, nullable=False)
    #: ISO 4217, upper case — `ck_purchase_order_currency_iso`.
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    payment_terms: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: The uploaded document this PO was read from, when there is one. Must be one
    #: of this deal's own documents — the service checks.
    source_document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            f"{SCHEMA}.crm_document.id",
            name="fk_purchase_order_source_document_id",
            ondelete="RESTRICT",
        ),
        nullable=True,
    )

    invoices: Mapped[list[Invoice]] = relationship(
        back_populates="purchase_order",
        cascade="all, delete-orphan",
        order_by="Invoice.invoice_date, Invoice.invoice_number",
        lazy="selectin",
    )


class Invoice(AnerModel):
    __tablename__ = "invoice"
    __table_args__ = (
        UniqueConstraint("purchase_order_id", "invoice_number", name="uq_invoice_po_number"),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="ck_invoice_currency_iso"),
        CheckConstraint("amount > 0", name="ck_invoice_amount_positive"),
        CheckConstraint("btrim(invoice_number) <> ''", name="ck_invoice_number_present"),
        CheckConstraint(
            "due_date IS NULL OR due_date >= invoice_date", name="ck_invoice_due_after_issue"
        ),
        Index("ix_invoice_purchase_order", "purchase_order_id", "invoice_date"),
        {"schema": SCHEMA},
    )

    purchase_order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            f"{SCHEMA}.purchase_order.id", name="fk_invoice_purchase_order_id", ondelete="CASCADE"
        ),
        nullable=False,
    )
    invoice_number: Mapped[str] = mapped_column(String(100), nullable=False)
    invoice_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    #: Always the PO's currency — the service refuses another.
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    source_document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            f"{SCHEMA}.crm_document.id",
            name="fk_invoice_source_document_id",
            ondelete="RESTRICT",
        ),
        nullable=True,
    )

    purchase_order: Mapped[PurchaseOrder] = relationship(back_populates="invoices")


__all__ = ["Invoice", "PurchaseOrder"]
