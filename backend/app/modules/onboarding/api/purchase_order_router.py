"""A deal's purchase order and invoices — build prompt chunk 2.

One deal → exactly one PO → one or more invoices. The PO is recorded **from an
uploaded document**: the document is uploaded to the deal first (the existing
deal-document route, category ``PRE_SHIPMENT``), an extractor may suggest its
fields (``.../purchase-order/suggestions``), and a person confirms them here. With
no extractor configured, the suggestion is empty and the person types the fields.

Roles (build prompt chunk 2): OPERATIONS and ADMIN record and correct the PO and
its invoices. **COMPLIANCE may not** — it records its decisions on the company,
never on PO or invoice fields. Every CRM reader (FINANCER and DEVELOPER included)
may read. Each gated route has a row in both authorization tables.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.onboarding.api.schemas.purchase_order import (
    DealPaperworkResponse,
    ExtractedFieldsResponse,
    InvoiceRequest,
    PurchaseOrderResponse,
    SetPurchaseOrderRequest,
)
from app.modules.onboarding.application.deal_service import DealService
from app.modules.onboarding.application.purchase_order_service import PurchaseOrderService
from app.modules.onboarding.domain.purchase_order_views import PurchaseOrderView
from app.platform.authentication.models import User, UserRole
from app.platform.authorization.services import require_role
from app.platform.database.services import get_db

router = APIRouter(tags=["Exporter CRM"])

#: Who may record or change a PO or invoice — and, as data, who `can_edit` says yes to.
_EDITING_ROLES = frozenset({UserRole.OPERATIONS, UserRole.ADMIN})
_EDITOR = require_role(*_EDITING_ROLES)
_READER = require_role(
    UserRole.OPERATIONS,
    UserRole.COMPLIANCE,
    UserRole.ADMIN,
    UserRole.DEVELOPER,
    UserRole.FINANCER,
)

_BASE = "/deals/{deal_id}/purchase-order"
_EDIT_ERRORS = {
    401: {"description": "Unauthorized"},
    403: {"description": "OPERATIONS or ADMIN role required"},
    404: {"description": "Deal, purchase order or invoice not found"},
    409: {"description": "The deal is handed over or withdrawn, or an invoice number is taken"},
    422: {"description": "Invalid field, a currency other than the PO's, or a foreign document"},
}


async def _paperwork(
    db: AsyncSession, deal_id: uuid.UUID, viewer: User, po: PurchaseOrderView | None
) -> DealPaperworkResponse:
    deal = await DealService(db).get_deal(deal_id)
    return DealPaperworkResponse(
        purchase_order=PurchaseOrderResponse.from_view(po) if po is not None else None,
        can_edit=viewer.role in _EDITING_ROLES and not deal.stage.is_terminal,
    )


@router.get(
    _BASE,
    response_model=DealPaperworkResponse,
    summary="The deal's purchase order and invoices",
    description=(
        "`purchase_order` is `null` until one is recorded. `can_edit` says whether "
        "this caller may record or change it now."
    ),
    responses={401: {"description": "Unauthorized"}, 403: {"description": "CRM read role required"}},
)
async def get_purchase_order(
    deal_id: uuid.UUID,
    current_user: Annotated[User, Depends(_READER)],
    db: AsyncSession = Depends(get_db),
) -> DealPaperworkResponse:
    po = await PurchaseOrderService(db).get(deal_id)
    return await _paperwork(db, deal_id, current_user, po)


@router.put(
    _BASE,
    response_model=DealPaperworkResponse,
    summary="Record or correct the deal's purchase order",
    description=(
        "One PO per deal, so `PUT`. `source_document_id`, when sent, must be one "
        "of this deal's documents. The currency cannot change while invoices exist."
    ),
    responses=_EDIT_ERRORS,
)
async def set_purchase_order(
    deal_id: uuid.UUID,
    body: SetPurchaseOrderRequest,
    current_user: Annotated[User, Depends(_EDITOR)],
    db: AsyncSession = Depends(get_db),
) -> DealPaperworkResponse:
    po = await PurchaseOrderService(db).set_purchase_order(
        deal_id, actor_id=str(current_user.id), **body.model_dump()
    )
    return await _paperwork(db, deal_id, current_user, po)


@router.post(
    f"{_BASE}/invoices",
    response_model=DealPaperworkResponse,
    status_code=201,
    summary="Add an invoice to the deal's purchase order",
    responses=_EDIT_ERRORS,
)
async def add_invoice(
    deal_id: uuid.UUID,
    body: InvoiceRequest,
    current_user: Annotated[User, Depends(_EDITOR)],
    db: AsyncSession = Depends(get_db),
) -> DealPaperworkResponse:
    po = await PurchaseOrderService(db).add_invoice(
        deal_id, actor_id=str(current_user.id), **body.model_dump()
    )
    return await _paperwork(db, deal_id, current_user, po)


@router.put(
    f"{_BASE}/invoices/{{invoice_id}}",
    response_model=DealPaperworkResponse,
    summary="Correct an invoice",
    responses=_EDIT_ERRORS,
)
async def update_invoice(
    deal_id: uuid.UUID,
    invoice_id: uuid.UUID,
    body: InvoiceRequest,
    current_user: Annotated[User, Depends(_EDITOR)],
    db: AsyncSession = Depends(get_db),
) -> DealPaperworkResponse:
    po = await PurchaseOrderService(db).update_invoice(
        deal_id, invoice_id, actor_id=str(current_user.id), **body.model_dump()
    )
    return await _paperwork(db, deal_id, current_user, po)


@router.delete(
    f"{_BASE}/invoices/{{invoice_id}}",
    response_model=DealPaperworkResponse,
    summary="Remove an invoice",
    description="Recorded in the deal's history; the invoice row itself is gone.",
    responses=_EDIT_ERRORS,
)
async def remove_invoice(
    deal_id: uuid.UUID,
    invoice_id: uuid.UUID,
    current_user: Annotated[User, Depends(_EDITOR)],
    db: AsyncSession = Depends(get_db),
) -> DealPaperworkResponse:
    po = await PurchaseOrderService(db).remove_invoice(
        deal_id, invoice_id, actor_id=str(current_user.id)
    )
    return await _paperwork(db, deal_id, current_user, po)


@router.get(
    f"{_BASE}/suggestions",
    response_model=ExtractedFieldsResponse,
    summary="Fields read from an uploaded PO or invoice — suggestions to confirm",
    description=(
        "Pluggable and optional: with no extractor configured, `extractor` is `null` "
        "and `fields` is empty, so the form starts blank. Nothing is saved."
    ),
    responses={**_EDIT_ERRORS, 422: {"description": "Not this deal's document, or not scanned clean"}},
)
async def suggest_fields(
    deal_id: uuid.UUID,
    current_user: Annotated[User, Depends(_EDITOR)],
    document_id: uuid.UUID = Query(),
    kind: Annotated[Literal["purchase_order", "invoice"], Query()] = "purchase_order",
    db: AsyncSession = Depends(get_db),
) -> ExtractedFieldsResponse:
    view = await PurchaseOrderService(db).suggest_from_document(deal_id, document_id, kind)
    return ExtractedFieldsResponse.from_view(view)


__all__ = ["router"]
