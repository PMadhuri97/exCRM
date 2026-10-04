"""Repository for ``exporter_profile`` rows (EXP-1)."""

from __future__ import annotations

import enum
import uuid
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import Row, Select, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.onboarding.domain.entities.exporter_contact import ExporterContact
from app.modules.onboarding.domain.entities.exporter_enums import (
    ExporterJourney,
    ExporterMarker,
    ExporterSource,
)
from app.modules.onboarding.domain.entities.exporter_gstin import ExporterGstin
from app.modules.onboarding.domain.entities.exporter_lifecycle_history import (
    HISTORY_DIMENSION_JOURNEY,
    ExporterLifecycleHistory,
)
from app.modules.onboarding.domain.entities.exporter_profile import ExporterProfile
from app.modules.onboarding.domain.entities.qualification_enums import QualificationState
from app.platform.database.adapters.repository import BaseRepository


class CompanySort(str, enum.Enum):
    """What the company list may be ordered by — a closed set, so a caller can
    never sort on a column the list does not mean to expose."""

    DATE_ADDED = "date_added"
    NAME = "name"
    #: How long the company has held its journey ("time in status").
    STATUS_SINCE = "status_since"


def status_since_expression():
    """When the company reached its current journey: its newest journey history
    row, or the day it was added if it has none. Correlated per row and served by
    ``ix_exporter_lifecycle_history_dimension_recent``."""
    latest = (
        select(func.max(ExporterLifecycleHistory.created_at))
        .where(
            ExporterLifecycleHistory.customer_id == ExporterProfile.customer_id,
            ExporterLifecycleHistory.dimension == HISTORY_DIMENSION_JOURNEY,
        )
        .correlate(ExporterProfile)
        .scalar_subquery()
    )
    return func.coalesce(latest, ExporterProfile.date_added)


class ExporterProfileRepository(BaseRepository[ExporterProfile]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(ExporterProfile, session)

    async def get_by_customer_id(self, customer_id: uuid.UUID) -> ExporterProfile | None:
        result = await self.session.execute(
            select(ExporterProfile).where(ExporterProfile.customer_id == customer_id)
        )
        return result.scalar_one_or_none()

    async def get_by_pan(self, pan: str) -> ExporterProfile | None:
        """The company holding ``pan`` — at most one (``uq_exporter_profile_pan``)."""
        result = await self.session.execute(
            select(ExporterProfile).where(ExporterProfile.pan == pan)
        )
        return result.scalar_one_or_none()

    async def get_many(self, customer_ids: Sequence[uuid.UUID]) -> list[ExporterProfile]:
        if not customer_ids:
            return []
        result = await self.session.execute(
            select(ExporterProfile).where(ExporterProfile.customer_id.in_(customer_ids))
        )
        return list(result.scalars().all())

    async def holders_of_identifiers(
        self,
        *,
        gstins: Sequence[str] = (),
        iec: str | None = None,
        cin: str | None = None,
    ) -> dict[uuid.UUID, set[str]]:
        """Every company holding any of these identifiers, with which ones it
        holds (`"gstin"`, `"iec"`, `"cin"`). PAN is looked up on its own: it
        is unique, and says which company a row *is*, not which it resembles."""
        holders: dict[uuid.UUID, set[str]] = {}
        if gstins:
            result = await self.session.execute(
                select(ExporterGstin.customer_id).where(ExporterGstin.gstin.in_(gstins)).distinct()
            )
            for customer_id in result.scalars():
                holders.setdefault(customer_id, set()).add("gstin")
        for column, value, label in (
            (ExporterProfile.iec, iec, "iec"),
            (ExporterProfile.cin, cin, "cin"),
        ):
            if value is None:
                continue
            result = await self.session.execute(
                select(ExporterProfile.customer_id).where(column == value)
            )
            for customer_id in result.scalars():
                holders.setdefault(customer_id, set()).add(label)
        return holders

    async def other_holders_of_gstins(
        self, gstins: Sequence[str], customer_id: uuid.UUID
    ) -> dict[str, list[uuid.UUID]]:
        """For each of ``gstins`` that another company also holds, those
        companies' ids. GSTINs nobody else holds are absent."""
        if not gstins:
            return {}
        result = await self.session.execute(
            select(ExporterGstin.gstin, ExporterGstin.customer_id)
            .where(
                ExporterGstin.gstin.in_(gstins),
                ExporterGstin.customer_id != customer_id,
            )
            .order_by(ExporterGstin.gstin, ExporterGstin.customer_id)
        )
        holders: dict[str, list[uuid.UUID]] = {}
        for gstin, holder in result.all():
            holders.setdefault(gstin, []).append(holder)
        return holders

    async def search(
        self,
        *,
        gstin: str | None = None,
        pan: str | None = None,
        iec: str | None = None,
        name_contains: str | None = None,
        source: ExporterSource | None = None,
        journey: ExporterJourney | None = None,
        qualification: QualificationState | None = None,
        marker: ExporterMarker | None = None,
        exclude_ended: bool = False,
        limit: int = 50,
        offset: int = 0,
    ) -> list[ExporterProfile]:
        """Filtered profile search, newest first.

        ``name_contains`` is a case-insensitive partial match on the name,
        taken literally: ``%`` and ``_`` in it match only themselves.
        ``gstin`` matches any of a company's GSTINs. ``exclude_ended`` drops
        ``ENDED`` companies — the service decides when (the default working
        list); this query only applies it.
        """
        stmt = self._filtered(
            select(ExporterProfile),
            gstin=gstin,
            pan=pan,
            iec=iec,
            name_contains=name_contains,
            source=source,
            journey=journey,
            qualification=qualification,
            marker=marker,
            exclude_ended=exclude_ended,
        )
        # `customer_id` breaks ties: companies created in one transaction share
        # a `created_at`, and without it a page boundary could repeat or skip one.
        stmt = (
            stmt.order_by(ExporterProfile.created_at.desc(), ExporterProfile.customer_id.desc())
            .limit(limit)
            .offset(offset)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def search_page(
        self,
        *,
        gstin: str | None = None,
        pan: str | None = None,
        iec: str | None = None,
        name_contains: str | None = None,
        source: ExporterSource | None = None,
        journey: ExporterJourney | None = None,
        qualification: QualificationState | None = None,
        marker: ExporterMarker | None = None,
        exclude_ended: bool = False,
        added_from: datetime | None = None,
        added_before: datetime | None = None,
        sort: CompanySort = CompanySort.DATE_ADDED,
        descending: bool = True,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[Row], int, dict[ExporterJourney, int]]:
        """The company list as a work queue: a page of companies, each with its
        primary contact (name, email, phone) and when it reached its journey, the
        total behind the page, and the count per journey.

        The per-journey counts honour every filter except ``journey``, so each
        journey tab can say how many it would hold before it is picked.
        ``name_contains`` also matches the primary contact's name.
        """
        filters = dict(
            gstin=gstin,
            pan=pan,
            iec=iec,
            source=source,
            qualification=qualification,
            marker=marker,
            exclude_ended=exclude_ended,
            added_from=added_from,
            added_before=added_before,
        )
        # At most one primary contact per company (a partial unique index), so
        # this join never multiplies a company's row.
        joined = select(ExporterProfile).outerjoin(
            ExporterContact,
            (ExporterContact.customer_id == ExporterProfile.customer_id)
            & ExporterContact.is_primary_contact.is_(True),
        )
        if name_contains is not None:
            pattern = f"%{_escape_like(name_contains)}%"
            joined = joined.where(
                ExporterProfile.name.ilike(pattern, escape="\\")
                | ExporterContact.name.ilike(pattern, escape="\\")
            )

        counted = self._filtered(joined, **filters).with_only_columns(
            ExporterProfile.journey
        ).subquery()
        counts = {value: 0 for value in ExporterJourney}
        for value, count in (
            await self.session.execute(
                select(counted.c.journey, func.count()).group_by(counted.c.journey)
            )
        ).all():
            counts[ExporterJourney(value)] = int(count)
        total = counts[journey] if journey is not None else sum(counts.values())

        since = status_since_expression()
        stmt = self._filtered(joined, journey=journey, **filters).with_only_columns(
            ExporterProfile,
            since.label("status_since"),
            ExporterContact.name,
            ExporterContact.email,
            ExporterContact.phone,
        )
        column = {
            CompanySort.DATE_ADDED: ExporterProfile.date_added,
            CompanySort.NAME: func.lower(ExporterProfile.name),
            CompanySort.STATUS_SINCE: since,
        }[sort]
        order = column.desc().nulls_last() if descending else column.asc().nulls_last()
        result = await self.session.execute(
            stmt.order_by(order, ExporterProfile.customer_id.desc()).limit(limit).offset(offset)
        )
        return list(result.all()), total, counts

    @staticmethod
    def _filtered(
        stmt: Select,
        *,
        gstin: str | None = None,
        pan: str | None = None,
        iec: str | None = None,
        name_contains: str | None = None,
        source: ExporterSource | None = None,
        journey: ExporterJourney | None = None,
        qualification: QualificationState | None = None,
        marker: ExporterMarker | None = None,
        exclude_ended: bool = False,
        added_from: datetime | None = None,
        added_before: datetime | None = None,
    ) -> Select:
        """The company filters, applied to ``stmt`` — shared by the plain search and
        the paged list, so the two can never disagree about who matches."""
        if gstin is not None:
            stmt = stmt.where(
                exists().where(
                    ExporterGstin.customer_id == ExporterProfile.customer_id,
                    ExporterGstin.gstin == gstin,
                )
            )
        if pan is not None:
            stmt = stmt.where(ExporterProfile.pan == pan)
        if iec is not None:
            stmt = stmt.where(ExporterProfile.iec == iec)
        if name_contains is not None:
            stmt = stmt.where(
                ExporterProfile.name.ilike(f"%{_escape_like(name_contains)}%", escape="\\")
            )
        if source is not None:
            stmt = stmt.where(ExporterProfile.source == source)
        if journey is not None:
            stmt = stmt.where(ExporterProfile.journey == journey)
        if qualification is not None:
            stmt = stmt.where(ExporterProfile.qualification == qualification)
        if marker is not None:
            stmt = stmt.where(ExporterProfile.marker == marker)
        elif exclude_ended:
            stmt = stmt.where(ExporterProfile.marker != ExporterMarker.ENDED)
        if added_from is not None:
            stmt = stmt.where(ExporterProfile.date_added >= added_from)
        if added_before is not None:
            stmt = stmt.where(ExporterProfile.date_added < added_before)
        return stmt


def _escape_like(value: str) -> str:
    """`value` for a LIKE pattern with a backslash as the escape character,
    so its own `%`, `_` and backslashes are matched literally."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


__all__ = ["CompanySort", "ExporterProfileRepository", "status_since_expression"]
