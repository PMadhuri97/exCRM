"""A deal's purchase order and invoices — build prompt chunk 2, migration 0023.

One deal → exactly one PO → one or more invoices; no handover without the PO
and at least one invoice. The database-level cases go through ``psycopg2`` so they
prove the *database* refuses the bad row, not only the service (migration register
§2). The rest go through the API as a person would.

Real Postgres, each test minting its own company and deal.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import psycopg2
import psycopg2.errors
import pytest
from httpx import AsyncClient
from sqlalchemy import select, update

from app.modules.onboarding.application.deal_service import DealService
from app.modules.onboarding.application.history_service import HistoryService
from app.modules.onboarding.domain.entities.background_check_enums import BackgroundCheckState
from app.modules.onboarding.domain.entities.crm_document import CrmDocument
from app.modules.onboarding.domain.entities.deal import Deal
from app.modules.onboarding.domain.entities.deal_enums import DealStage
from app.modules.onboarding.domain.entities.document_enums import DocumentCategory, DocumentSource
from app.modules.onboarding.domain.entities.exporter_enums import ExporterJourney
from app.modules.onboarding.domain.entities.exporter_profile import ExporterProfile
from app.modules.onboarding.domain.storage import DocumentScanStatus
from app.modules.onboarding.tests.fixtures.auth import auth_header, token_with_role
from app.modules.onboarding.tests.fixtures.companies import make_company
from app.platform.authentication.models import UserRole
from app.platform.configuration.config import get_settings
from app.platform.database import services as db_services

pytestmark = pytest.mark.asyncio

BASE = "/api/v1/onboarding"
PO = {"po_number": "PO-77", "po_date": "2026-09-01", "currency": "usd", "total_amount": "1000.00"}


def _connect():
    url = get_settings().DATABASE_SYNC_URL.replace("postgresql+psycopg2://", "postgresql://")
    return psycopg2.connect(url)


async def _advance(
    journey: ExporterJourney = ExporterJourney.PROSPECT,
    check: BackgroundCheckState = BackgroundCheckState.NOT_STARTED,
) -> tuple[uuid.UUID, uuid.UUID]:
    """A company at ``journey`` with its check at ``check``, and one deal at
    GATHERING_PAPERWORK with a buyer. Set directly: this file is about the PO."""
    company_id = await make_company()
    async with db_services.AsyncSessionLocal() as db:
        await db.execute(
            update(ExporterProfile)
            .where(ExporterProfile.customer_id == company_id)
            .values(journey=ExporterJourney.PROSPECT)
        )
        await db.commit()
    async with db_services.AsyncSessionLocal() as db:
        view = await DealService(db).open_deal(company_id, reference="Rotterdam", actor_id="t")
    async with db_services.AsyncSessionLocal() as db:
        await DealService(db).set_buyer(view.id, name="Rotterdam BV", country="NL", actor_id="t")
    async with db_services.AsyncSessionLocal() as db:
        await DealService(db).transition_stage(view.id, DealStage.GATHERING_PAPERWORK, actor_id="t")
    async with db_services.AsyncSessionLocal() as db:
        await db.execute(
            update(ExporterProfile)
            .where(ExporterProfile.customer_id == company_id)
            .values(journey=journey, background_check=check)
        )
        await db.commit()
    return company_id, view.id


async def _document(deal_id: uuid.UUID) -> uuid.UUID:
    """A clean PO document on ``deal_id`` — a row, no file: nothing here reads it."""
    async with db_services.AsyncSessionLocal() as db:
        document = CrmDocument(
            deal_id=deal_id,
            category=DocumentCategory.PRE_SHIPMENT,
            document_type="purchase_order",
            source=DocumentSource.EXPORTER_UPLOAD,
            file_name="po.pdf",
            content_type="application/pdf",
            size_bytes=10,
            uploaded_at=datetime.now(UTC),
            scan_status=DocumentScanStatus.AVAILABLE,
            storage_key=f"deals/{deal_id}/pre_shipment/exporter_upload/{uuid.uuid4()}",
        )
        db.add(document)
        await db.commit()
        return document.id


async def _ops(client: AsyncClient) -> dict:
    return auth_header(await token_with_role(client, UserRole.OPERATIONS))


# ── The database refuses what the structure forbids ──────────────────────────


def _insert_po(cursor, deal_id, *, number="PO-1", currency="USD", total="10.00") -> str:
    cursor.execute(
        "INSERT INTO onboarding.purchase_order (deal_id, po_number, po_date, currency, total_amount)"
        " VALUES (%s, %s, '2026-09-01', %s, %s) RETURNING id",
        (str(deal_id), number, currency, total),
    )
    return cursor.fetchone()[0]


async def test_one_purchase_order_per_advance_is_enforced_by_the_database():
    _, deal_id = await _advance()
    with _connect() as connection, connection.cursor() as cursor:
        _insert_po(cursor, deal_id)
        with pytest.raises(psycopg2.errors.UniqueViolation):
            _insert_po(cursor, deal_id, number="PO-2")


@pytest.mark.parametrize(
    ("currency", "total"), [("usd", "10.00"), ("US", "10.00"), ("USD", "0"), ("USD", "-5")]
)
async def test_a_bad_currency_or_amount_is_refused_by_the_database(currency, total):
    _, deal_id = await _advance()
    with _connect() as connection, connection.cursor() as cursor:
        with pytest.raises(psycopg2.errors.CheckViolation):
            _insert_po(cursor, deal_id, currency=currency, total=total)


async def test_invoice_numbers_are_unique_within_a_po_and_due_after_issue():
    _, deal_id = await _advance()
    with _connect() as connection, connection.cursor() as cursor:
        po_id = _insert_po(cursor, deal_id)
        insert = (
            "INSERT INTO onboarding.invoice"
            " (purchase_order_id, invoice_number, invoice_date, due_date, currency, amount)"
            " VALUES (%s, %s, '2026-09-10', %s, 'USD', '5.00')"
        )
        cursor.execute(insert, (po_id, "INV-1", None))
        with pytest.raises(psycopg2.errors.UniqueViolation):
            cursor.execute(insert, (po_id, "INV-1", None))
    with _connect() as connection, connection.cursor() as cursor:
        po_id = _insert_po(cursor, (await _advance())[1])
        with pytest.raises(psycopg2.errors.CheckViolation):
            cursor.execute(insert, (po_id, "INV-2", "2026-09-01"))


# ── Through the API ──────────────────────────────────────────────────────────


async def test_an_advance_starts_with_no_po_and_operations_may_record_one(client: AsyncClient):
    _, deal_id = await _advance()
    headers = await _ops(client)

    empty = await client.get(f"{BASE}/deals/{deal_id}/purchase-order", headers=headers)
    assert empty.status_code == 200, empty.text
    assert empty.json() == {"purchase_order": None, "can_edit": True}

    saved = await client.put(f"{BASE}/deals/{deal_id}/purchase-order", json=PO, headers=headers)
    assert saved.status_code == 200, saved.text
    po = saved.json()["purchase_order"]
    assert po["po_number"] == "PO-77"
    assert po["currency"] == "USD"  # upper-cased
    assert po["invoices"] == []
    assert po["uninvoiced_amount"] == "1000.00"


async def test_compliance_reads_the_po_but_may_not_edit_it(client: AsyncClient):
    _, deal_id = await _advance()
    await client.put(f"{BASE}/deals/{deal_id}/purchase-order", json=PO, headers=await _ops(client))
    compliance = auth_header(await token_with_role(client, UserRole.COMPLIANCE))

    read = await client.get(f"{BASE}/deals/{deal_id}/purchase-order", headers=compliance)
    write = await client.put(f"{BASE}/deals/{deal_id}/purchase-order", json=PO, headers=compliance)

    assert read.status_code == 200
    assert read.json()["can_edit"] is False
    assert write.status_code == 403


async def test_invoices_sum_against_the_po_and_one_order_can_be_split(client: AsyncClient):
    _, deal_id = await _advance()
    headers = await _ops(client)
    await client.put(f"{BASE}/deals/{deal_id}/purchase-order", json=PO, headers=headers)
    url = f"{BASE}/deals/{deal_id}/purchase-order/invoices"

    first = await client.post(
        url, json={"invoice_number": "A", "invoice_date": "2026-09-05", "amount": "600.00"},
        headers=headers,
    )
    second = await client.post(
        url,
        json={"invoice_number": "B", "invoice_date": "2026-09-06", "amount": "250.50",
              "due_date": "2026-11-05"},
        headers=headers,
    )

    assert first.status_code == 201, first.text
    po = second.json()["purchase_order"]
    assert [i["invoice_number"] for i in po["invoices"]] == ["A", "B"]
    assert po["invoiced_amount"] == "850.50"
    assert po["uninvoiced_amount"] == "149.50"
    assert po["invoices"][1]["currency"] == "USD"  # the PO's


async def test_invoice_rules_are_refused_with_their_codes(client: AsyncClient):
    _, deal_id = await _advance()
    headers = await _ops(client)
    url = f"{BASE}/deals/{deal_id}/purchase-order/invoices"
    invoice = {"invoice_number": "A", "invoice_date": "2026-09-05", "amount": "10.00"}

    no_po = await client.post(url, json=invoice, headers=headers)
    await client.put(f"{BASE}/deals/{deal_id}/purchase-order", json=PO, headers=headers)
    await client.post(url, json=invoice, headers=headers)
    duplicate = await client.post(url, json=invoice, headers=headers)
    other_currency = await client.post(
        url, json={**invoice, "invoice_number": "B", "currency": "EUR"}, headers=headers
    )
    locked = await client.put(
        f"{BASE}/deals/{deal_id}/purchase-order", json={**PO, "currency": "EUR"}, headers=headers
    )

    assert no_po.json()["error_code"] == "PURCHASE_ORDER_NOT_FOUND"
    assert duplicate.json()["error_code"] == "INVOICE_NUMBER_TAKEN"
    assert other_currency.json()["error_code"] == "INVOICE_CURRENCY_MISMATCH"
    assert locked.json()["error_code"] == "PURCHASE_ORDER_CURRENCY_LOCKED"


async def test_an_invoice_can_be_corrected_and_removed(client: AsyncClient):
    company_id, deal_id = await _advance()
    headers = await _ops(client)
    await client.put(f"{BASE}/deals/{deal_id}/purchase-order", json=PO, headers=headers)
    added = await client.post(
        f"{BASE}/deals/{deal_id}/purchase-order/invoices",
        json={"invoice_number": "A", "invoice_date": "2026-09-05", "amount": "10.00"},
        headers=headers,
    )
    invoice_id = added.json()["purchase_order"]["invoices"][0]["id"]
    url = f"{BASE}/deals/{deal_id}/purchase-order/invoices/{invoice_id}"

    fixed = await client.put(
        url, json={"invoice_number": "A-1", "invoice_date": "2026-09-05", "amount": "12.00"},
        headers=headers,
    )
    removed = await client.delete(url, headers=headers)

    assert fixed.json()["purchase_order"]["invoices"][0]["invoice_number"] == "A-1"
    assert removed.json()["purchase_order"]["invoices"] == []
    async with db_services.AsyncSessionLocal() as db:
        rows, _ = await HistoryService(db).list_for_company(company_id, dimension="deal")
    events = [row.event_type for row in rows]
    for event in ("purchase_order_recorded", "invoice_added", "invoice_changed", "invoice_removed"):
        assert event in events


async def test_a_source_document_must_be_this_advances_own(client: AsyncClient):
    _, deal_id = await _advance()
    _, other_deal = await _advance()
    headers = await _ops(client)
    mine = await _document(deal_id)
    theirs = await _document(other_deal)

    ok = await client.put(
        f"{BASE}/deals/{deal_id}/purchase-order",
        json={**PO, "source_document_id": str(mine)},
        headers=headers,
    )
    refused = await client.put(
        f"{BASE}/deals/{deal_id}/purchase-order",
        json={**PO, "source_document_id": str(theirs)},
        headers=headers,
    )

    assert ok.json()["purchase_order"]["source_document_id"] == str(mine)
    assert refused.status_code == 422
    assert refused.json()["error_code"] == "SOURCE_DOCUMENT_NOT_ON_DEAL"


async def test_suggestions_are_empty_while_no_extractor_is_configured(client: AsyncClient):
    _, deal_id = await _advance()
    document_id = await _document(deal_id)

    response = await client.get(
        f"{BASE}/deals/{deal_id}/purchase-order/suggestions",
        params={"document_id": str(document_id), "kind": "purchase_order"},
        headers=await _ops(client),
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"extractor": None, "fields": {}}


async def test_a_closed_advance_is_frozen(client: AsyncClient):
    _, deal_id = await _advance()
    headers = await _ops(client)
    async with db_services.AsyncSessionLocal() as db:
        await DealService(db).transition_stage(
            deal_id, DealStage.WITHDRAWN, reason="Buyer cancelled", actor_id="t"
        )

    read = await client.get(f"{BASE}/deals/{deal_id}/purchase-order", headers=headers)
    write = await client.put(f"{BASE}/deals/{deal_id}/purchase-order", json=PO, headers=headers)

    assert read.json()["can_edit"] is False
    assert write.status_code == 409
    assert write.json()["error_code"] == "DEAL_TERMINAL"


# ── No handover without the PO and at least one invoice ─────────────────────


async def test_the_handover_waits_for_the_po_and_an_invoice(client: AsyncClient):
    _, deal_id = await _advance(ExporterJourney.CUSTOMER, BackgroundCheckState.CLEAR)
    headers = await _ops(client)

    async def blocked() -> tuple[str | None, set[str]]:
        deal = (await client.get(f"{BASE}/deals/{deal_id}", headers=headers)).json()
        return deal["handover_blocked_reason"], {m["to_stage"] for m in deal["allowed_stage_moves"]}

    assert await blocked() == ("there is no purchase order", {"WITHDRAWN"})
    await client.put(f"{BASE}/deals/{deal_id}/purchase-order", json=PO, headers=headers)
    assert await blocked() == ("the purchase order has no invoice", {"WITHDRAWN"})
    await client.post(
        f"{BASE}/deals/{deal_id}/purchase-order/invoices",
        json={"invoice_number": "A", "invoice_date": "2026-09-05", "amount": "1000.00"},
        headers=headers,
    )
    assert await blocked() == (None, {"WITHDRAWN", "HANDED_OVER"})

    handed = await client.post(
        f"{BASE}/deals/{deal_id}/transitions", json={"to_stage": "HANDED_OVER"}, headers=headers
    )
    assert handed.status_code == 200, handed.text


async def test_a_handover_without_paperwork_is_refused(client: AsyncClient):
    _, deal_id = await _advance(ExporterJourney.CUSTOMER, BackgroundCheckState.CLEAR)

    response = await client.post(
        f"{BASE}/deals/{deal_id}/transitions",
        json={"to_stage": "HANDED_OVER"},
        headers=await _ops(client),
    )

    assert response.status_code == 409
    assert response.json()["error_code"] == "DEAL_HANDOVER_BLOCKED"
    async with db_services.AsyncSessionLocal() as db:
        stage = await db.scalar(select(Deal.stage).where(Deal.id == deal_id))
    assert stage is DealStage.GATHERING_PAPERWORK
