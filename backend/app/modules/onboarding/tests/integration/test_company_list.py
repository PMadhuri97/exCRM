"""The company list as a work queue — Centrex's contact list (Centrex §5).

`GET /onboarding/exporters` now carries each company's primary contact and how
long it has held its journey (its status), the total behind the page, and the
count per journey; it filters by the day a company was added and sorts by time
in status. The filters and the `ENDED` rule it always had are unchanged.

Real Postgres, shared and never reset, so each test narrows by a name unique to
it and counts only its own rows.
"""

from __future__ import annotations

import secrets
import string
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import update

from app.modules.onboarding.domain.entities.exporter_contact import ExporterContact
from app.modules.onboarding.domain.entities.exporter_enums import (
    ExporterJourney,
    ExporterMarker,
)
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

BASE = "/api/v1/onboarding/exporters"


def _pan() -> str:
    letters = "".join(secrets.choice(string.ascii_uppercase) for _ in range(5))
    return f"{letters}{secrets.randbelow(10_000):04d}F"


async def _company(name: str, **values) -> uuid.UUID:
    company_id = await make_company()
    async with db_services.AsyncSessionLocal() as db:
        await db.execute(
            update(ExporterProfile)
            .where(ExporterProfile.customer_id == company_id)
            .values(name=name, **values)
        )
        await db.commit()
    return company_id


async def _contact(company_id: uuid.UUID, name: str, *, primary: bool = True) -> None:
    async with db_services.AsyncSessionLocal() as db:
        db.add(
            ExporterContact(
                customer_id=company_id,
                name=name,
                email="meera.iyer@bharat.example",
                phone="+91 98200 12345",
                is_primary_contact=primary,
            )
        )
        await db.commit()


async def _list(client: AsyncClient, token: str, **params) -> dict:
    response = await client.get(BASE, params=params, headers=auth_header(token))
    assert response.status_code == 200, response.text
    return response.json()


async def test_a_row_carries_the_primary_contact_masked_for_operations(client: AsyncClient):
    tag = uuid.uuid4().hex[:10]
    pan = _pan()
    company = await _company(f"Contact {tag}", pan=pan)
    await _contact(company, "Not the primary", primary=False)
    await _contact(company, f"Meera {tag}")

    ops = (await _list(client, await token_with_role(client, UserRole.OPERATIONS), name=tag))
    compliance = await _list(client, await token_with_role(client, UserRole.COMPLIANCE), name=tag)

    # One row, not one per contact — only the primary is joined.
    assert ops["total"] == 1
    row = ops["profiles"][0]
    assert row["primary_contact_name"] == f"Meera {tag}"
    assert row["pan"] == "••••••" + pan[-4:]
    assert row["primary_contact_email"] != "meera.iyer@bharat.example"
    assert row["primary_contact_phone"].endswith("2345")
    assert row["primary_contact_phone"] != "+91 98200 12345"
    full = compliance["profiles"][0]
    assert full["pan"] == pan
    assert full["primary_contact_email"] == "meera.iyer@bharat.example"
    assert full["primary_contact_phone"] == "+91 98200 12345"


async def test_search_matches_the_primary_contacts_name(client: AsyncClient):
    token = await token_with_role(client, UserRole.OPERATIONS)
    tag = uuid.uuid4().hex[:10]
    company = await _company("An exporter with an ordinary name")
    await _contact(company, f"Zubin {tag}")

    body = await _list(client, token, name=f"Zubin {tag}")

    assert [row["customer_id"] for row in body["profiles"]] == [str(company)]


async def test_status_since_is_the_latest_journey_row_or_the_day_added(client: AsyncClient):
    token = await token_with_role(client, UserRole.OPERATIONS)
    tag = uuid.uuid4().hex[:10]
    moved = await _company(f"Moved {tag}")
    never = await _company(f"Never moved {tag}", date_added=datetime(2024, 5, 1, tzinfo=UTC))
    since = datetime(2026, 8, 1, tzinfo=UTC)
    async with db_services.AsyncSessionLocal() as db:
        db.add(
            ExporterLifecycleHistory(
                customer_id=moved,
                dimension=HISTORY_DIMENSION_JOURNEY,
                event_type="lifecycle_transition",
                from_status="LEAD",
                to_status="PROSPECT",
                actor_id="t",
                created_at=since,
            )
        )
        await db.commit()

    rows = {r["customer_id"]: r for r in (await _list(client, token, name=tag))["profiles"]}

    assert datetime.fromisoformat(rows[str(moved)]["status_since"]) == since
    assert datetime.fromisoformat(rows[str(never)]["status_since"]) == datetime(
        2024, 5, 1, tzinfo=UTC
    )


async def test_journey_counts_ignore_the_journey_filter(client: AsyncClient):
    token = await token_with_role(client, UserRole.OPERATIONS)
    tag = uuid.uuid4().hex[:10]
    await _company(f"Lead {tag}")
    await _company(f"Prospect {tag}", journey=ExporterJourney.PROSPECT)
    await _company(f"Customer {tag}", journey=ExporterJourney.CUSTOMER)

    everything = await _list(client, token, name=tag)
    prospects = await _list(client, token, name=tag, journey="PROSPECT")

    expected = {"LEAD": 1, "PROSPECT": 1, "CUSTOMER": 1}
    assert everything["journey_counts"] == expected
    assert prospects["journey_counts"] == expected
    assert everything["total"] == 3
    assert prospects["total"] == 1


async def test_the_added_range_is_inclusive_calendar_days(client: AsyncClient):
    token = await token_with_role(client, UserRole.OPERATIONS)
    tag = uuid.uuid4().hex[:10]
    start = datetime(2003, 6, 10, tzinfo=UTC)
    await _company(f"Before {tag}", date_added=start - timedelta(seconds=1))
    first = await _company(f"First {tag}", date_added=start)
    last = await _company(f"Last {tag}", date_added=start + timedelta(days=1, hours=23))
    await _company(f"After {tag}", date_added=start + timedelta(days=2))

    body = await _list(client, token, name=tag, added_from="2003-06-10", added_to="2003-06-11")

    assert {r["customer_id"] for r in body["profiles"]} == {str(first), str(last)}


async def test_an_added_range_that_ends_before_it_starts_is_refused(client: AsyncClient):
    token = await token_with_role(client, UserRole.OPERATIONS)
    response = await client.get(
        BASE,
        params={"added_from": "2026-09-30", "added_to": "2026-09-01"},
        headers=auth_header(token),
    )
    assert response.status_code == 422


async def test_rows_sort_by_time_in_status(client: AsyncClient):
    token = await token_with_role(client, UserRole.OPERATIONS)
    tag = uuid.uuid4().hex[:10]
    older = await _company(f"Older {tag}", date_added=datetime(2020, 1, 1, tzinfo=UTC))
    newer = await _company(f"Newer {tag}", date_added=datetime(2025, 1, 1, tzinfo=UTC))

    body = await _list(client, token, name=tag, sort="status_since", order="asc")

    assert [r["customer_id"] for r in body["profiles"]] == [str(older), str(newer)]


async def test_ended_companies_stay_out_of_the_default_list(client: AsyncClient):
    """Assumption A11, unchanged: the working list hides ENDED; a search or the
    marker filter brings them back."""
    token = await token_with_role(client, UserRole.OPERATIONS)
    tag = uuid.uuid4().hex[:10]
    ended = await _company(f"Ended {tag}", marker=ExporterMarker.ENDED, marker_reason="closed")

    default = await _list(client, token, qualification="NOT_YET_REVIEWED", added_from="2000-01-01")
    by_marker = await _list(client, token, marker="ENDED", name=tag)

    assert str(ended) not in {r["customer_id"] for r in default["profiles"]}
    assert [r["customer_id"] for r in by_marker["profiles"]] == [str(ended)]
