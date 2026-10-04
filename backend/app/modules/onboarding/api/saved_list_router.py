"""Saved lists — build prompt chunk 3; Centrex §4.

Every CRM reader sees every list; only **ADMIN and DEVELOPER** build them (settled
30 September 2026). A list's creator, or an ADMIN, may change or delete it.

A list never carries rows: the screen opens one by asking the ordinary list
endpoint with the viewer's own role, so masking and decision D8 apply to the
viewer, never to the builder. Each gated route has a row in both authorization
tables.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.onboarding.api.actor_names import actor_names
from app.modules.onboarding.api.schemas.saved_list import (
    SavedListRequest,
    SavedListResponse,
    SavedListsResponse,
)
from app.modules.onboarding.application.saved_list_service import SavedListService
from app.modules.onboarding.domain.entities.saved_list import SavedList, SavedListObject
from app.platform.authentication.models import User, UserRole
from app.platform.authorization.services import require_role
from app.platform.database.services import get_db

router = APIRouter(tags=["Exporter CRM"])

#: Who may build a list — and, as data, who `can_create` says yes to.
_BUILDING_ROLES = frozenset({UserRole.ADMIN, UserRole.DEVELOPER})
_BUILDER = require_role(*_BUILDING_ROLES)
_READER = require_role(
    UserRole.OPERATIONS,
    UserRole.COMPLIANCE,
    UserRole.ADMIN,
    UserRole.DEVELOPER,
    UserRole.FINANCER,
)
_WRITE_ERRORS = {
    401: {"description": "Unauthorized"},
    403: {"description": "ADMIN or DEVELOPER role required, or the list is someone else's"},
    409: {"description": "A list of this kind already has that name"},
    422: {"description": "A filter, sort or column the list's endpoint does not have"},
}


def _may_edit(saved: SavedList, viewer: User) -> bool:
    return viewer.role is UserRole.ADMIN or (
        viewer.role in _BUILDING_ROLES and saved.created_by == viewer.id
    )


async def _responses(db: AsyncSession, viewer: User, lists: list[SavedList]) -> list[SavedListResponse]:
    names = await actor_names(db, viewer, (str(saved.created_by) for saved in lists))
    return [
        SavedListResponse(
            id=saved.id,
            name=saved.name,
            object_type=SavedListObject(saved.object_type),
            filters=saved.filters,
            columns=saved.columns,
            sort=saved.sort,
            sort_order=saved.sort_order,
            created_by=saved.created_by,
            created_by_name=names.get(str(saved.created_by)),
            created_at=saved.created_at,
            updated_at=saved.updated_at,
            can_edit=_may_edit(saved, viewer),
        )
        for saved in lists
    ]


@router.get(
    "/saved-lists",
    response_model=SavedListsResponse,
    summary="Every saved list, or every list of one kind",
    description=(
        "Visible to every CRM reader. `can_create` says whether this caller may build "
        "one; each list's `can_edit` whether this caller may change it."
    ),
    responses={401: {"description": "Unauthorized"}, 403: {"description": "CRM read role required"}},
)
async def list_saved_lists(
    current_user: Annotated[User, Depends(_READER)],
    object_type: SavedListObject | None = None,
    db: AsyncSession = Depends(get_db),
) -> SavedListsResponse:
    lists = await SavedListService(db).list(object_type)
    return SavedListsResponse(
        lists=await _responses(db, current_user, lists),
        can_create=current_user.role in _BUILDING_ROLES,
    )


@router.post(
    "/saved-lists",
    response_model=SavedListResponse,
    status_code=201,
    summary="Build a saved list",
    responses=_WRITE_ERRORS,
)
async def create_saved_list(
    body: SavedListRequest,
    current_user: Annotated[User, Depends(_BUILDER)],
    db: AsyncSession = Depends(get_db),
) -> SavedListResponse:
    saved = await SavedListService(db).create(actor_id=current_user.id, **body.model_dump())
    return (await _responses(db, current_user, [saved]))[0]


@router.put(
    "/saved-lists/{list_id}",
    response_model=SavedListResponse,
    summary="Change a saved list — its creator, or an admin",
    responses={**_WRITE_ERRORS, 404: {"description": "Saved list not found"}},
)
async def update_saved_list(
    list_id: uuid.UUID,
    body: SavedListRequest,
    current_user: Annotated[User, Depends(_BUILDER)],
    db: AsyncSession = Depends(get_db),
) -> SavedListResponse:
    saved = await SavedListService(db).update(
        list_id,
        actor_id=current_user.id,
        actor_is_admin=current_user.role is UserRole.ADMIN,
        **body.model_dump(),
    )
    return (await _responses(db, current_user, [saved]))[0]


@router.delete(
    "/saved-lists/{list_id}",
    status_code=204,
    summary="Delete a saved list — its creator, or an admin",
    responses={**_WRITE_ERRORS, 404: {"description": "Saved list not found"}},
)
async def delete_saved_list(
    list_id: uuid.UUID,
    current_user: Annotated[User, Depends(_BUILDER)],
    db: AsyncSession = Depends(get_db),
) -> Response:
    await SavedListService(db).delete(
        list_id, actor_id=current_user.id, actor_is_admin=current_user.role is UserRole.ADMIN
    )
    return Response(status_code=204)


__all__ = ["router"]
