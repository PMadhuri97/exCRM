"""Logging a call — Centrex §6, migration 0025.

One save records the call (direction, result, duration, notes, the contact), and
optionally moves the conversation gauge and schedules a follow-up — together or
not at all. The database keeps the call fields on calls only.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

import psycopg2
import psycopg2.errors
import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, update

from app.modules.onboarding.domain.entities.exporter_activity import ExporterActivity
from app.modules.onboarding.domain.entities.exporter_contact import ExporterContact
from app.modules.onboarding.domain.entities.exporter_enums import ExporterJourney
from app.modules.onboarding.domain.entities.exporter_profile import ExporterProfile
from app.modules.onboarding.tests.fixtures.auth import auth_header, token_with_role
from app.modules.onboarding.tests.fixtures.companies import make_company
from app.platform.authentication.models import UserRole
from app.platform.configuration.config import get_settings
from app.platform.database import services as db_services

pytestmark = pytest.mark.asyncio

BASE = "/api/v1/onboarding/exporters"


async def _company(journey: ExporterJourney = ExporterJourney.PROSPECT) -> tuple[uuid.UUID, uuid.UUID]:
    """A company at ``journey`` with one primary contact."""
    company_id = await make_company()
    async with db_services.AsyncSessionLocal() as db:
        await db.execute(
            update(ExporterProfile)
            .where(ExporterProfile.customer_id == company_id)
            .values(name="Bharat Precision Metals", journey=journey)
        )
        contact = ExporterContact(
            customer_id=company_id, name="Rohan Mehta", phone="+91 22 5550 2222", is_primary_contact=True
        )
        db.add(contact)
        await db.commit()
        return company_id, contact.id


async def _activity_count(company_id: uuid.UUID) -> int:
    async with db_services.AsyncSessionLocal() as db:
        return int(
            await db.scalar(
                select(func.count()).select_from(ExporterActivity).where(
                    ExporterActivity.customer_id == company_id
                )
            )
        )


async def _ops(client: AsyncClient) -> dict:
    return auth_header(await token_with_role(client, UserRole.OPERATIONS))


async def test_a_call_is_logged_with_its_details(client: AsyncClient):
    company_id, contact_id = await _company()

    response = await client.post(
        f"{BASE}/{company_id}/calls",
        json={
            "contact_id": str(contact_id),
            "direction": "OUTBOUND",
            "result": "CONNECTED",
            "duration_seconds": 245,
            "notes": "  Confirmed the March PO with the buyer.  ",
        },
        headers=await _ops(client),
    )

    assert response.status_code == 201, response.text
    call = response.json()["call"]
    assert call["activity_type"] == "CALL"
    assert call["subject"] == "Outgoing call to Rohan Mehta — connected"
    assert call["call_direction"] == "OUTBOUND"
    assert call["call_result"] == "CONNECTED"
    assert call["call_duration_seconds"] == 245
    assert call["contact_id"] == str(contact_id)
    assert call["notes"] == "Confirmed the March PO with the buyer."
    assert response.json()["follow_up"] is None
    assert response.json()["conversation"] is None


async def test_a_call_can_move_the_status_and_schedule_a_follow_up(client: AsyncClient):
    company_id, contact_id = await _company()
    due = (datetime.now(UTC) + timedelta(days=3)).replace(microsecond=0)

    response = await client.post(
        f"{BASE}/{company_id}/calls",
        json={
            "contact_id": str(contact_id),
            "direction": "INBOUND",
            "result": "CALL_BACK_REQUESTED",
            "status": {"to": "READY_NOW"},
            "follow_up_at": due.isoformat(),
        },
        headers=await _ops(client),
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["conversation"] == "READY_NOW"
    assert body["follow_up"]["activity_type"] == "FOLLOW_UP"
    assert body["follow_up"]["subject"] == "Call Rohan Mehta back"
    assert datetime.fromisoformat(body["follow_up"]["due_at"]) == due
    async with db_services.AsyncSessionLocal() as db:
        profile = await db.scalar(
            select(ExporterProfile).where(ExporterProfile.customer_id == company_id)
        )
    assert profile.conversation.value == "READY_NOW"


async def test_a_refused_status_move_logs_no_call(client: AsyncClient):
    """All or nothing: NOT_NOW without its reason and check-back date is refused,
    and the call is not logged either."""
    company_id, _ = await _company()
    before = await _activity_count(company_id)

    response = await client.post(
        f"{BASE}/{company_id}/calls",
        json={"direction": "OUTBOUND", "result": "CONNECTED", "status": {"to": "NOT_NOW"}},
        headers=await _ops(client),
    )

    assert response.status_code == 422
    assert await _activity_count(company_id) == before


async def test_a_lead_has_no_status_to_move_but_its_calls_are_logged(client: AsyncClient):
    company_id, _ = await _company(ExporterJourney.LEAD)
    headers = await _ops(client)

    moved = await client.post(
        f"{BASE}/{company_id}/calls",
        json={"direction": "OUTBOUND", "result": "NO_ANSWER", "status": {"to": "READY_NOW"}},
        headers=headers,
    )
    plain = await client.post(
        f"{BASE}/{company_id}/calls",
        json={"direction": "OUTBOUND", "result": "NO_ANSWER"},
        headers=headers,
    )

    assert moved.status_code == 409
    assert plain.status_code == 201
    assert plain.json()["call"]["subject"] == "Outgoing call — no answer"


async def test_not_now_with_its_reason_and_date_is_accepted(client: AsyncClient):
    company_id, _ = await _company()
    response = await client.post(
        f"{BASE}/{company_id}/calls",
        json={
            "direction": "OUTBOUND",
            "result": "CONNECTED",
            "status": {
                "to": "NOT_NOW",
                "reason": "Busy season until November",
                "check_back_on": (date.today() + timedelta(days=30)).isoformat(),
            },
        },
        headers=await _ops(client),
    )
    assert response.status_code == 201, response.text
    assert response.json()["conversation"] == "NOT_NOW"


async def test_a_foreign_contact_and_a_past_follow_up_are_refused(client: AsyncClient):
    company_id, _ = await _company()
    _, someone_elses = await _company()
    headers = await _ops(client)

    foreign = await client.post(
        f"{BASE}/{company_id}/calls",
        json={"contact_id": str(someone_elses), "direction": "OUTBOUND", "result": "CONNECTED"},
        headers=headers,
    )
    past = await client.post(
        f"{BASE}/{company_id}/calls",
        json={
            "direction": "OUTBOUND",
            "result": "CONNECTED",
            "follow_up_at": (datetime.now(UTC) - timedelta(hours=1)).isoformat(),
        },
        headers=headers,
    )

    assert foreign.status_code == 422
    assert past.status_code == 422


async def test_the_activity_list_carries_the_call_details(client: AsyncClient):
    company_id, contact_id = await _company()
    headers = await _ops(client)
    await client.post(
        f"{BASE}/{company_id}/calls",
        json={"contact_id": str(contact_id), "direction": "OUTBOUND", "result": "VOICEMAIL",
              "duration_seconds": 30},
        headers=headers,
    )

    listed = await client.get(f"{BASE}/{company_id}/activities", headers=headers)

    call = listed.json()["activities"][0]
    assert (call["call_result"], call["call_duration_seconds"]) == ("VOICEMAIL", 30)


async def test_the_database_keeps_call_fields_on_calls_only():
    company_id, _ = await _company()
    url = get_settings().DATABASE_SYNC_URL.replace("postgresql+psycopg2://", "postgresql://")
    with psycopg2.connect(url) as connection, connection.cursor() as cursor:
        with pytest.raises(psycopg2.errors.CheckViolation):
            cursor.execute(
                "INSERT INTO onboarding.exporter_activity"
                " (id, customer_id, activity_type, subject, actor_id, occurred_at, call_result)"
                " VALUES (%s, %s, 'NOTE', 'a note', 't', now(), 'CONNECTED')",
                (str(uuid.uuid4()), str(company_id)),
            )
