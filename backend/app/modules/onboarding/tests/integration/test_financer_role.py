"""FINANCER — the underwriter and the financier, one role (auth_0005).

Which routes admit it is the two authorization tables' job; this file checks what
it is *served* once in: the underwriting data it needs (the background check, which
DEVELOPER is refused under D8), identifiers still masked, and no move offered
anywhere, because it decides nothing yet.
"""

from __future__ import annotations

import secrets
import string
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.modules.onboarding.application.deal_service import DealService
from app.modules.onboarding.domain.entities.background_check_enums import BackgroundCheckState
from app.modules.onboarding.domain.entities.exporter_enums import ExporterJourney
from app.modules.onboarding.domain.entities.exporter_profile import ExporterProfile
from app.modules.onboarding.tests.fixtures.auth import auth_header, token_with_role
from app.modules.onboarding.tests.fixtures.companies import make_company
from app.platform.authentication.models import UserRole
from app.platform.database import services as db_services

pytestmark = pytest.mark.asyncio

BASE = "/api/v1/onboarding"


def _pan() -> str:
    """A well-formed PAN (five letters, four digits, a letter) unlikely to collide
    with any earlier run's — the database is not reset and PAN is unique."""
    letters = "".join(secrets.choice(string.ascii_uppercase) for _ in range(5))
    return f"{letters}{secrets.randbelow(10_000):04d}F"


async def _prospect_with_deal(tag: str, pan: str | None = None) -> tuple[uuid.UUID, uuid.UUID]:
    """A cleared PROSPECT with a PAN on file and one open deal."""
    company_id = await make_company()
    async with db_services.AsyncSessionLocal() as db:
        profile = await db.scalar(
            select(ExporterProfile).where(ExporterProfile.customer_id == company_id)
        )
        profile.name = f"Financer view {tag}"
        profile.journey = ExporterJourney.PROSPECT
        profile.background_check = BackgroundCheckState.CLEAR
        profile.pan = pan or _pan()
        await db.commit()
    async with db_services.AsyncSessionLocal() as db:
        deal = await DealService(db).open_deal(company_id, reference=f"Order {tag}", actor_id="t")
    return company_id, deal.id


async def test_financer_sees_the_background_check_on_the_advances_list(client: AsyncClient):
    token = await token_with_role(client, UserRole.FINANCER)
    tag = uuid.uuid4().hex[:10]
    await _prospect_with_deal(tag)

    queue = await client.get(f"{BASE}/deals", params={"q": tag}, headers=auth_header(token))
    summary = await client.get(f"{BASE}/deals/summary", headers=auth_header(token))

    assert queue.status_code == 200, queue.text
    assert queue.json()["deals"][0]["company_background_check"] == "CLEAR"
    assert summary.status_code == 200, summary.text
    assert summary.json()["deals_opened_checks_clear"] is not None


async def test_financer_reads_the_background_check_but_is_offered_no_move(client: AsyncClient):
    token = await token_with_role(client, UserRole.FINANCER)
    company_id, _ = await _prospect_with_deal(uuid.uuid4().hex[:10])

    response = await client.get(
        f"{BASE}/exporters/{company_id}/background-check", headers=auth_header(token)
    )

    assert response.status_code == 200, response.text
    assert response.json()["value"] == "CLEAR"
    assert response.json()["allowed_moves"] == []


async def test_financer_reads_a_deal_but_is_offered_no_stage_move(client: AsyncClient):
    token = await token_with_role(client, UserRole.FINANCER)
    _, deal_id = await _prospect_with_deal(uuid.uuid4().hex[:10])

    response = await client.get(f"{BASE}/deals/{deal_id}", headers=auth_header(token))

    assert response.status_code == 200, response.text
    assert response.json()["allowed_stage_moves"] == []
    assert response.json()["handover_blocked_reason"] is None


async def test_financer_sees_identifiers_masked(client: AsyncClient):
    token = await token_with_role(client, UserRole.FINANCER)
    raw = _pan()
    company_id, _ = await _prospect_with_deal(uuid.uuid4().hex[:10], pan=raw)

    response = await client.get(f"{BASE}/exporters/{company_id}", headers=auth_header(token))

    assert response.status_code == 200, response.text
    pan = response.json()["pan"]
    assert pan != raw
    assert pan.endswith(raw[-4:])


async def test_financer_cannot_move_a_deal(client: AsyncClient):
    token = await token_with_role(client, UserRole.FINANCER)
    _, deal_id = await _prospect_with_deal(uuid.uuid4().hex[:10])

    response = await client.post(
        f"{BASE}/deals/{deal_id}/transitions",
        json={"to_stage": "GATHERING_PAPERWORK"},
        headers=auth_header(token),
    )

    assert response.status_code == 403
