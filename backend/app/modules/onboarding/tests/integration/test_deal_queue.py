"""The cross-company deal queue and its KPI bar — the Deals list (build prompt
chunk 1; Centrex §4/§5).

Real Postgres, shared with the rest of the suite, so nothing here counts rows it
did not make: list tests narrow by a token unique to the test, and summary tests
read a random historical window that only they write into.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update

from app.modules.onboarding.application.deal_service import DealService
from app.modules.onboarding.domain.entities.background_check_enums import BackgroundCheckState
from app.modules.onboarding.domain.entities.deal import Deal
from app.modules.onboarding.domain.entities.deal_enums import DealStage
from app.modules.onboarding.domain.entities.exporter_enums import ExporterJourney
from app.modules.onboarding.domain.entities.exporter_lifecycle_history import (
    HISTORY_DIMENSION_JOURNEY,
    ExporterLifecycleHistory,
)
from app.modules.onboarding.domain.entities.exporter_profile import ExporterProfile
from app.modules.onboarding.tests.fixtures.auth import auth_header, token_with_role
from app.modules.onboarding.tests.fixtures.companies import make_company
from app.platform.authentication.models import UserRole
from app.platform.database import services as db_services

pytestmark = pytest.mark.asyncio

BASE = "/api/v1/onboarding"


async def _company(
    name: str,
    *,
    background_check: BackgroundCheckState = BackgroundCheckState.NOT_STARTED,
) -> uuid.UUID:
    """A named PROSPECT, its background check set directly — this file is about the
    queue, not the rules that move either gauge."""
    company_id = await make_company()
    async with db_services.AsyncSessionLocal() as db:
        profile = await db.scalar(
            select(ExporterProfile).where(ExporterProfile.customer_id == company_id)
        )
        profile.name = name
        profile.journey = ExporterJourney.PROSPECT
        profile.background_check = background_check
        await db.commit()
    return company_id


async def _deal(company_id: uuid.UUID, reference: str, *, buyer: str | None = None) -> uuid.UUID:
    async with db_services.AsyncSessionLocal() as db:
        view = await DealService(db).open_deal(company_id, reference=reference, actor_id="t")
    if buyer is not None:
        async with db_services.AsyncSessionLocal() as db:
            await DealService(db).set_buyer(view.id, name=buyer, country="NL", actor_id="t")
    return view.id


async def _set_deal(deal_id: uuid.UUID, **values) -> None:
    """Rewrite a deal's stage or timestamps directly: the summary is about what the
    rows say, and driving a real handover needs a cleared CUSTOMER and a buyer."""
    async with db_services.AsyncSessionLocal() as db:
        await db.execute(update(Deal).where(Deal.id == deal_id).values(**values))
        await db.commit()


async def _queue(client: AsyncClient, token: str, **params) -> dict:
    response = await client.get(f"{BASE}/deals", params=params, headers=auth_header(token))
    assert response.status_code == 200, response.text
    return response.json()


# ── The list ────────────────────────────────────────────────────────────────


async def test_the_queue_spans_companies_and_carries_the_triage_fields(client: AsyncClient):
    token = await token_with_role(client, UserRole.OPERATIONS)
    tag = uuid.uuid4().hex[:10]
    first = await _company(f"Alpha {tag}", background_check=BackgroundCheckState.CLEAR)
    second = await _company(f"Beta {tag}")
    await _deal(first, "Rotterdam order", buyer="Harbour BV")
    await _deal(second, "Dubai order")

    body = await _queue(client, token, q=tag)

    assert body["total"] == 2
    rows = {row["company_name"]: row for row in body["deals"]}
    assert rows[f"Alpha {tag}"]["buyer_name"] == "Harbour BV"
    assert rows[f"Alpha {tag}"]["buyer_country"] == "NL"
    assert rows[f"Alpha {tag}"]["company_journey"] == "PROSPECT"
    assert rows[f"Alpha {tag}"]["company_background_check"] == "CLEAR"
    assert rows[f"Beta {tag}"]["buyer_name"] is None


async def test_search_matches_reference_company_and_buyer_literally(client: AsyncClient):
    token = await token_with_role(client, UserRole.COMPLIANCE)
    tag = uuid.uuid4().hex[:10]
    company = await _company(f"Company {tag}")
    other = await _company("Unrelated exporter")
    await _deal(other, f"Order ref-{tag}")
    await _deal(other, "Order via buyer", buyer=f"Buyer {tag}")
    await _deal(company, "Anything")

    assert (await _queue(client, token, q=tag))["total"] == 3
    assert (await _queue(client, token, q=f"ref-{tag}"))["total"] == 1
    # `%` is a character to find, not a wildcard.
    assert (await _queue(client, token, q=f"{tag}%"))["total"] == 0


async def test_the_stage_filter_narrows_rows_but_not_the_tab_counts(client: AsyncClient):
    token = await token_with_role(client, UserRole.ADMIN)
    tag = uuid.uuid4().hex[:10]
    company = await _company(f"Stages {tag}")
    await _deal(company, "one")
    moving = await _deal(company, "two")
    await _set_deal(moving, stage=DealStage.GATHERING_PAPERWORK)

    everything = await _queue(client, token, q=tag)
    narrowed = await _queue(client, token, q=tag, stage="GATHERING_PAPERWORK")

    assert everything["total"] == 2
    assert narrowed["total"] == 1
    assert narrowed["deals"][0]["reference"] == "two"
    expected = {"OPEN": 1, "GATHERING_PAPERWORK": 1, "HANDED_OVER": 0, "WITHDRAWN": 0}
    assert everything["stage_counts"] == expected
    assert narrowed["stage_counts"] == expected


async def test_company_id_scopes_the_queue_to_one_company(client: AsyncClient):
    token = await token_with_role(client, UserRole.OPERATIONS)
    company = await _company("Scoped exporter")
    await _deal(company, "mine")
    await _deal(await _company("Someone else"), "theirs")

    body = await _queue(client, token, company_id=str(company))

    assert [row["reference"] for row in body["deals"]] == ["mine"]


async def test_sorting_by_reference_both_ways(client: AsyncClient):
    token = await token_with_role(client, UserRole.OPERATIONS)
    company = await _company(f"Sorted {uuid.uuid4().hex[:10]}")
    for reference in ("bravo", "Alpha", "charlie"):
        await _deal(company, reference)

    ascending = await _queue(client, token, company_id=str(company), sort="reference", order="asc")
    descending = await _queue(
        client, token, company_id=str(company), sort="reference", order="desc"
    )

    # Case-insensitive, so "Alpha" is first rather than sorted by code point.
    assert [row["reference"] for row in ascending["deals"]] == ["Alpha", "bravo", "charlie"]
    assert [row["reference"] for row in descending["deals"]] == ["charlie", "bravo", "Alpha"]


async def test_developer_reads_the_queue_without_the_background_check(client: AsyncClient):
    """Decision D8: DEVELOPER is never served a company's background check."""
    token = await token_with_role(client, UserRole.DEVELOPER)
    tag = uuid.uuid4().hex[:10]
    await _deal(
        await _company(f"Masked {tag}", background_check=BackgroundCheckState.FLAGGED), "x"
    )

    row = (await _queue(client, token, q=tag))["deals"][0]

    assert row["company_background_check"] is None


async def test_an_unknown_sort_is_refused(client: AsyncClient):
    token = await token_with_role(client, UserRole.OPERATIONS)
    response = await client.get(
        f"{BASE}/deals", params={"sort": "tax_id"}, headers=auth_header(token)
    )
    assert response.status_code == 422


# ── The KPI bar ─────────────────────────────────────────────────────────────

def _window() -> tuple[datetime, datetime]:
    """A thirty-day window somewhere in 1950–2030 that no other test writes into.

    The database is not reset between runs, so a fixed window would count every
    earlier run's rows too; a random one collides with a past run about once in a
    thousand.
    """
    start = datetime(1950, 1, 1, tzinfo=UTC) + timedelta(days=30 * secrets.randbelow(900))
    return start, start + timedelta(days=30)


def _params(start: datetime, end: datetime) -> dict:
    return {"from": start.isoformat(), "to": end.isoformat()}


async def _seed(start: datetime) -> None:
    """Two deals opened in the window, one on a CLEAR company and handed over four
    days later; one company added and one made CUSTOMER in the same window."""
    clear = await _company("Window clear", background_check=BackgroundCheckState.CLEAR)
    unchecked = await _company("Window unchecked")
    handed = await _deal(clear, "handed")
    pending = await _deal(unchecked, "pending")
    await _set_deal(
        handed,
        stage=DealStage.HANDED_OVER,
        created_at=start + timedelta(days=1),
        handed_over_at=start + timedelta(days=5),
    )
    await _set_deal(pending, created_at=start + timedelta(days=9))
    async with db_services.AsyncSessionLocal() as db:
        await db.execute(
            update(ExporterProfile)
            .where(ExporterProfile.customer_id == unchecked)
            .values(date_added=start + timedelta(days=2))
        )
        db.add(
            ExporterLifecycleHistory(
                customer_id=clear,
                dimension=HISTORY_DIMENSION_JOURNEY,
                event_type="lifecycle_transition",
                from_status="PROSPECT",
                to_status="CUSTOMER",
                actor_id="t",
                created_at=start + timedelta(days=3),
            )
        )
        await db.commit()


async def test_the_summary_computes_the_period_figures(client: AsyncClient):
    start, end = _window()
    await _seed(start)
    token = await token_with_role(client, UserRole.COMPLIANCE)

    response = await client.get(
        f"{BASE}/deals/summary", params=_params(start, end), headers=auth_header(token)
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["deals_opened"] == 2
    assert body["deals_opened_checks_clear"] == 1
    assert body["average_turnaround_days"] == 4.0
    assert body["new_leads"] == 1
    assert body["new_customers"] == 1
    assert set(body["stage_counts"]) == {stage.value for stage in DealStage}


async def test_the_summary_hides_the_cleared_count_from_developer(client: AsyncClient):
    token = await token_with_role(client, UserRole.DEVELOPER)
    response = await client.get(
        f"{BASE}/deals/summary", params=_params(*_window()), headers=auth_header(token)
    )
    assert response.status_code == 200, response.text
    assert response.json()["deals_opened_checks_clear"] is None


async def test_the_summary_refuses_a_period_that_ends_before_it_starts(client: AsyncClient):
    token = await token_with_role(client, UserRole.OPERATIONS)
    response = await client.get(
        f"{BASE}/deals/summary",
        params=_params(*reversed(_window())),
        headers=auth_header(token),
    )
    assert response.status_code == 422


# ── Opened-date range ───────────────────────────────────────────────────────


async def test_the_opened_range_is_inclusive_calendar_days(client: AsyncClient):
    token = await token_with_role(client, UserRole.OPERATIONS)
    start, _ = _window()
    company = await _company(f"Range {uuid.uuid4().hex[:10]}")
    before = await _deal(company, "before")
    first_day = await _deal(company, "first day")
    last_day = await _deal(company, "last day")
    after = await _deal(company, "after")
    await _set_deal(before, created_at=start - timedelta(seconds=1))
    await _set_deal(first_day, created_at=start)
    await _set_deal(last_day, created_at=start + timedelta(days=2, hours=23, minutes=59))
    await _set_deal(after, created_at=start + timedelta(days=3))

    body = await _queue(
        client,
        token,
        company_id=str(company),
        opened_from=start.date().isoformat(),
        opened_to=(start + timedelta(days=2)).date().isoformat(),
        sort="created_at",
        order="asc",
    )

    assert [row["reference"] for row in body["deals"]] == ["first day", "last day"]
    # The tab counts honour the date range too.
    assert body["stage_counts"]["OPEN"] == 2


async def test_an_opened_range_that_ends_before_it_starts_is_refused(client: AsyncClient):
    token = await token_with_role(client, UserRole.OPERATIONS)
    response = await client.get(
        f"{BASE}/deals",
        params={"opened_from": "2026-09-30", "opened_to": "2026-09-01"},
        headers=auth_header(token),
    )
    assert response.status_code == 422


async def test_a_row_carries_when_the_deal_was_handed_over(client: AsyncClient):
    token = await token_with_role(client, UserRole.OPERATIONS)
    company = await _company(f"Handed {uuid.uuid4().hex[:10]}")
    await _deal(company, "still open")
    handed = await _deal(company, "handed")
    at = datetime(2026, 9, 1, 12, tzinfo=UTC)
    await _set_deal(handed, stage=DealStage.HANDED_OVER, handed_over_at=at)

    rows = {
        row["reference"]: row
        for row in (await _queue(client, token, company_id=str(company)))["deals"]
    }

    assert rows["still open"]["handed_over_at"] is None
    assert datetime.fromisoformat(rows["handed"]["handed_over_at"]) == at


async def test_a_row_carries_its_purchase_order_and_invoices(client: AsyncClient):
    from app.modules.onboarding.tests.fixtures.paperwork import add_paperwork

    token = await token_with_role(client, UserRole.OPERATIONS)
    company = await _company(f"Paper {uuid.uuid4().hex[:10]}")
    await _deal(company, "no po")
    backed = await _deal(company, "with po")
    await add_paperwork(backed)

    rows = {
        row["reference"]: row
        for row in (await _queue(client, token, company_id=str(company)))["deals"]
    }

    assert rows["no po"]["po_total"] is None
    assert rows["no po"]["invoice_count"] == 0
    assert rows["with po"]["po_currency"] == "USD"
    assert rows["with po"]["po_total"] == "125000.00"
    assert rows["with po"]["invoice_count"] == 1
    assert rows["with po"]["invoiced_total"] == "125000.00"
