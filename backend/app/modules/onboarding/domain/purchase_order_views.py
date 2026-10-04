"""Read-model views for purchase orders and invoices — build prompt chunk 2.

Pure data, the same pattern as ``deal_views.py``. ``PurchaseOrderService``
assembles them.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal


@dataclass(frozen=True)
class InvoiceView:
    id: uuid.UUID
    purchase_order_id: uuid.UUID
    invoice_number: str
    invoice_date: date
    due_date: date | None
    currency: str
    amount: Decimal
    source_document_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class PurchaseOrderView:
    """The PO, its invoices, and the sums a reader would otherwise do by hand.

    ``uninvoiced_amount`` is the PO total less the invoices, and may be negative:
    invoices exceeding their PO is something to see and question in verification,
    not something this read hides or refuses.
    """

    id: uuid.UUID
    deal_id: uuid.UUID
    po_number: str
    po_date: date
    currency: str
    total_amount: Decimal
    payment_terms: str | None
    source_document_id: uuid.UUID | None
    invoices: tuple[InvoiceView, ...]
    invoiced_amount: Decimal
    uninvoiced_amount: Decimal
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class ExtractedFields:
    """What an extractor read from an uploaded document — suggestions for a person
    to confirm, never saved on their own. Every field may be missing; ``extractor``
    is ``None`` when no extractor is configured, so the form simply starts blank.
    """

    extractor: str | None
    fields: dict[str, str] = field(default_factory=dict)
