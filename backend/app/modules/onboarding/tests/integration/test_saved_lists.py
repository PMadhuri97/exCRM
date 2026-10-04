"""Saved lists — build prompt chunk 3; Centrex §4.

Every CRM reader sees every list; only ADMIN and DEVELOPER build them; a list's
creator, or an ADMIN, may change or delete it. A list's filters are the list
endpoint's own parameters, checked against its object type — never an identifier
search. Which roles reach the routes at all is the authorization tables' job.

Real Postgres, shared and never reset, so list names carry a token unique to the
test (names are unique per object type).
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient

from app.modules.onboarding.tests.fixtures.auth import auth_header, token_with_role
from app.platform.authentication.models import UserRole

pytestmark = pytest.mark.asyncio

URL = "/api/v1/onboarding/saved-lists"


def _name(label: str) -> str:
    return f"{label} {uuid.uuid4().hex[:8]}"


async def _headers(client: AsyncClient, role: UserRole) -> dict:
    return auth_header(await token_with_role(client, role))


async def test_an_admin_builds_a_list_and_every_reader_sees_it(client: AsyncClient):
    admin = await _headers(client, UserRole.ADMIN)
    name = _name("Ready to fund")
    created = await client.post(
        URL,
        json={
            "name": name,
            "object_type": "DEALS",
            "filters": {"stages": ["GATHERING_PAPERWORK"], "q": "rotterdam"},
            "columns": ["reference", "amount", "stage"],
            "sort": "created_at",
            "sort_order": "desc",
        },
        headers=admin,
    )
    assert created.status_code == 201, created.text
    assert created.json()["can_edit"] is True

    for role in (UserRole.OPERATIONS, UserRole.COMPLIANCE, UserRole.FINANCER, UserRole.DEVELOPER):
        listing = await client.get(
            URL, params={"object_type": "DEALS"}, headers=await _headers(client, role)
        )
        assert listing.status_code == 200, listing.text
        mine = next(item for item in listing.json()["lists"] if item["name"] == name)
        assert mine["filters"] == {"stages": ["GATHERING_PAPERWORK"], "q": "rotterdam"}
        # Only ADMIN may touch another's list; DEVELOPER only its own.
        assert mine["can_edit"] is False
        assert listing.json()["can_create"] is (role is UserRole.DEVELOPER)


async def test_a_developer_may_change_its_own_list_but_not_an_admins(client: AsyncClient):
    developer = await _headers(client, UserRole.DEVELOPER)
    admin = await _headers(client, UserRole.ADMIN)
    own = await client.post(
        URL, json={"name": _name("Dev view"), "object_type": "COMPANIES"}, headers=developer
    )
    theirs = await client.post(
        URL, json={"name": _name("Admin view"), "object_type": "COMPANIES"}, headers=admin
    )
    own_id, their_id = own.json()["id"], theirs.json()["id"]

    renamed = await client.put(
        f"{URL}/{own_id}",
        json={"name": _name("Dev view renamed"), "object_type": "COMPANIES"},
        headers=developer,
    )
    refused = await client.put(
        f"{URL}/{their_id}", json={"name": _name("Hijack"), "object_type": "COMPANIES"},
        headers=developer,
    )
    not_deleted = await client.delete(f"{URL}/{their_id}", headers=developer)
    admin_deletes_devs = await client.delete(f"{URL}/{own_id}", headers=admin)

    assert renamed.status_code == 200, renamed.text
    assert refused.status_code == 403
    assert refused.json()["error_code"] == "SAVED_LIST_NOT_YOURS"
    assert not_deleted.status_code == 403
    assert admin_deletes_devs.status_code == 204


async def test_filters_must_be_the_object_types_own(client: AsyncClient):
    admin = await _headers(client, UserRole.ADMIN)

    company_filter_on_advances = await client.post(
        URL,
        json={"name": _name("Mixed"), "object_type": "DEALS", "filters": {"journey": "LEAD"}},
        headers=admin,
    )
    company_sort_on_advances = await client.post(
        URL,
        json={"name": _name("Mixed sort"), "object_type": "DEALS", "sort": "status_since"},
        headers=admin,
    )
    identifier_search = await client.post(
        URL,
        json={"name": _name("Oracle"), "object_type": "COMPANIES", "filters": {"pan": "ABCDE1234F"}},
        headers=admin,
    )
    bad_range = await client.post(
        URL,
        json={
            "name": _name("Backwards"),
            "object_type": "COMPANIES",
            "filters": {"added_from": "2026-09-30", "added_to": "2026-09-01"},
        },
        headers=admin,
    )

    assert company_filter_on_advances.status_code == 422
    assert company_sort_on_advances.status_code == 422
    # An exact identifier search is an existence oracle, kept to COMPLIANCE/ADMIN on
    # the endpoint itself — never stored for every reader to run.
    assert identifier_search.status_code == 422
    assert bad_range.status_code == 422


async def test_company_filters_are_stored_as_the_endpoint_takes_them(client: AsyncClient):
    admin = await _headers(client, UserRole.ADMIN)
    response = await client.post(
        URL,
        json={
            "name": _name("RXIL prospects"),
            "object_type": "COMPANIES",
            "filters": {"journey": "PROSPECT", "source": "RXIL", "added_from": "2026-01-01"},
            "sort": "status_since",
            "sort_order": "asc",
        },
        headers=admin,
    )
    assert response.status_code == 201, response.text
    assert response.json()["filters"] == {
        "journey": "PROSPECT",
        "source": "RXIL",
        "added_from": "2026-01-01",
    }


async def test_two_lists_of_one_kind_may_not_share_a_name(client: AsyncClient):
    admin = await _headers(client, UserRole.ADMIN)
    name = _name("Duplicate")
    first = await client.post(URL, json={"name": name, "object_type": "DEALS"}, headers=admin)
    second = await client.post(URL, json={"name": name, "object_type": "DEALS"}, headers=admin)
    other_kind = await client.post(URL, json={"name": name, "object_type": "COMPANIES"}, headers=admin)

    assert first.status_code == 201
    assert second.status_code == 409
    assert second.json()["error_code"] == "SAVED_LIST_NAME_TAKEN"
    assert other_kind.status_code == 201


async def test_operations_may_not_build_a_list(client: AsyncClient):
    response = await client.post(
        URL,
        json={"name": _name("Nope"), "object_type": "DEALS"},
        headers=await _headers(client, UserRole.OPERATIONS),
    )
    assert response.status_code == 403
