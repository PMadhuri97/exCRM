"""Request/response schemas for a deal's purchase order and invoices — build
prompt chunk 2.

Nothing here is masked: a PO number, invoice numbers, dates and amounts are trade
facts every CRM reader may see, not identifiers (`masking.py` covers PAN, GSTIN,
IEC, CIN and personal contact details). Amounts travel as strings in JSON
(`Decimal`), so a reader never sees `0.30000000000000004` for a sum of money.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from app.modules.onboarding.domain.purchase_order_views import (
    ExtractedFields,
    InvoiceView,
    PurchaseOrderView,
)

#: Money: positive, at most 16 digits before the point and 2 after.
Money = Annotated[Decimal, Field(gt=0, max_digits=18, decimal_places=2)]


class SetPurchaseOrderRequest(BaseModel):
    """Record or correct the deal's purchase order — one per deal."""

    model_config = ConfigDict(extra="forbid")

    po_number: str = Field(min_length=1, max_length=100)
    po_date: date
    currency: str = Field(min_length=3, max_length=3, description="ISO 4217, e.g. USD")
    total_amount: Money
    payment_terms: str | None = Field(default=None, max_length=2000)
    source_document_id: uuid.UUID | None = Field(
        default=None, description="The uploaded document the PO was read from — one of this deal's."
    )


class InvoiceRequest(BaseModel):
    """An invoice against the deal's PO. `currency` may be left out — it is
    the PO's; another is refused."""

    model_config = ConfigDict(extra="forbid")

    invoice_number: str = Field(min_length=1, max_length=100)
    invoice_date: date
    due_date: date | None = None
    amount: Money
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    source_document_id: uuid.UUID | None = None


class InvoiceResponse(BaseModel):
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

    @classmethod
    def from_view(cls, view: InvoiceView) -> InvoiceResponse:
        return cls(**view.__dict__)


class PurchaseOrderResponse(BaseModel):
    id: uuid.UUID
    deal_id: uuid.UUID
    po_number: str
    po_date: date
    currency: str
    total_amount: Decimal
    payment_terms: str | None
    source_document_id: uuid.UUID | None
    invoices: list[InvoiceResponse]
    invoiced_amount: Decimal = Field(description="The invoices, summed.")
    uninvoiced_amount: Decimal = Field(
        description="The PO total less its invoices. May be negative — a question for verification."
    )
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_view(cls, view: PurchaseOrderView) -> PurchaseOrderResponse:
        data = dict(view.__dict__)
        data["invoices"] = [InvoiceResponse.from_view(i) for i in view.invoices]
        return cls(**data)


class DealPaperworkResponse(BaseModel):
    """The deal's PO (or `null` — none recorded yet), and whether **this**
    caller may record or change it, so the screen offers only what the server
    would accept (§7.5)."""

    purchase_order: PurchaseOrderResponse | None
    can_edit: bool = Field(
        description="OPERATIONS or ADMIN, on a deal that is not handed over or withdrawn."
    )


class ExtractedFieldsResponse(BaseModel):
    """Suggestions read from a document, for a person to confirm. `extractor` is
    `null` when none is configured, and `fields` is then empty."""

    extractor: str | None
    fields: dict[str, str]

    @classmethod
    def from_view(cls, view: ExtractedFields) -> ExtractedFieldsResponse:
        return cls(extractor=view.extractor, fields=dict(view.fields))


__all__ = [
    "DealPaperworkResponse",
    "ExtractedFieldsResponse",
    "InvoiceRequest",
    "InvoiceResponse",
    "PurchaseOrderResponse",
    "SetPurchaseOrderRequest",
]
