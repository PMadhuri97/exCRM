"""Saved lists — build prompt chunk 3; Centrex §4 ("Dynamic List Builder").

A saved list is a definition (filters, columns, sort) over the Deals or the
Companies list — never rows. **Who** may build one (ADMIN, DEVELOPER) is the
route's; this service enforces **whose** a list is: its creator, or an ADMIN, may
change or delete it. Every CRM reader may see every list (settled 30 September
2026), so reads are not owner-scoped.

The filters arrive already checked against the object type by the request schema;
this service stores them as given.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.onboarding.domain.entities.saved_list import SavedList, SavedListObject
from app.modules.onboarding.exceptions import (
    SavedListNameTakenError,
    SavedListNotFoundError,
    SavedListNotYoursError,
)


class SavedListService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def list(self, object_type: SavedListObject | None = None) -> list[SavedList]:
        """Every list, or every list of one kind, by name."""
        statement = select(SavedList).order_by(SavedList.object_type, SavedList.name)
        if object_type is not None:
            statement = statement.where(SavedList.object_type == object_type.value)
        return list((await self._db.scalars(statement)).all())

    async def create(
        self,
        *,
        name: str,
        object_type: SavedListObject,
        filters: dict,
        columns: list[str],
        sort: str | None,
        sort_order: str | None,
        actor_id: uuid.UUID,
    ) -> SavedList:
        saved = SavedList(
            name=name,
            object_type=object_type.value,
            filters=filters,
            columns=columns,
            sort=sort,
            sort_order=sort_order,
            created_by=actor_id,
        )
        self._db.add(saved)
        await self._commit(name)
        await self._db.refresh(saved)
        return saved

    async def update(
        self,
        list_id: uuid.UUID,
        *,
        name: str,
        object_type: SavedListObject,
        filters: dict,
        columns: list[str],
        sort: str | None,
        sort_order: str | None,
        actor_id: uuid.UUID,
        actor_is_admin: bool,
    ) -> SavedList:
        saved = await self._owned(list_id, actor_id, actor_is_admin)
        saved.name = name
        saved.object_type = object_type.value
        saved.filters = filters
        saved.columns = columns
        saved.sort = sort
        saved.sort_order = sort_order
        await self._commit(name)
        await self._db.refresh(saved)
        return saved

    async def delete(self, list_id: uuid.UUID, *, actor_id: uuid.UUID, actor_is_admin: bool) -> None:
        saved = await self._owned(list_id, actor_id, actor_is_admin)
        await self._db.delete(saved)
        await self._db.commit()

    async def _owned(self, list_id: uuid.UUID, actor_id: uuid.UUID, actor_is_admin: bool) -> SavedList:
        saved = await self._db.get(SavedList, list_id)
        if saved is None:
            raise SavedListNotFoundError(list_id)
        if not actor_is_admin and saved.created_by != actor_id:
            raise SavedListNotYoursError(list_id)
        return saved

    async def _commit(self, name: str) -> None:
        try:
            await self._db.commit()
        except IntegrityError as error:
            await self._db.rollback()
            if "uq_saved_list_type_name" in str(error.orig):
                raise SavedListNameTakenError(name) from error
            raise


__all__ = ["SavedListService"]
