"""The cross-company deal queue and its KPI bar — the Deals list.

Build prompt chunk 1; Centrex reference §4 ("Dynamic List Builder / Work Queues")
and §5 ("Contact List / Operational Workbench"). "Deal" is the label on the
screen; in code a deal stays a ``Deal``.

**Read-only.** Nothing here writes; stage moves stay ``DealService``'s, behind its
guards. Which roles may read, and what DEVELOPER is not shown, is the route's.

**Every figure is computed here, not on the screen**, so the list, the Home page
and any saved list built later (chunk 3) read one set of numbers. There is no
"open value": a deal holds no amount yet, and which field will is waiting on the
PO/invoice entity (chunk 2) — the summary leaves it out rather than guess.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.onboarding.domain.deal_views import (
    DealQueueItemView,
    DealQueuePage,
    DealQueueSort,
    DealSummaryView,
)
from app.modules.onboarding.domain.entities.background_check_enums import (
    BackgroundCheckState,
)
from app.modules.onboarding.domain.entities.deal import Deal
from app.modules.onboarding.domain.entities.deal_enums import DealStage
from app.modules.onboarding.domain.entities.exporter_enums import ExporterJourney
from app.modules.onboarding.domain.entities.exporter_lifecycle_history import (
    HISTORY_DIMENSION_JOURNEY,
    ExporterLifecycleHistory,
)
from app.modules.onboarding.domain.entities.exporter_profile import ExporterProfile
from app.modules.onboarding.infrastructure.repositories.deal_repository import DealRepository

#: The KPI bar's default window when the caller names none.
DEFAULT_PERIOD_DAYS = 30

_SECONDS_PER_DAY = 86_400


class DealQueueService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db
        self._deals = DealRepository(db)

    async def list_queue(
        self,
        *,
        stages: tuple[DealStage, ...] | None = None,
        search: str | None = None,
        company_id: uuid.UUID | None = None,
        opened_on_or_after: date | None = None,
        opened_on_or_before: date | None = None,
        sort: DealQueueSort = DealQueueSort.UPDATED_AT,
        descending: bool = True,
        limit: int = 50,
        offset: int = 0,
    ) -> DealQueuePage:
        """``opened_on_or_after`` / ``opened_on_or_before`` are calendar days, both
        inclusive, read in UTC — the day a person picks, not an instant."""
        rows, total, stage_counts = await self._deals.list_queue(
            stages=stages,
            search=(search or "").strip() or None,
            company_id=company_id,
            opened_from=_start_of(opened_on_or_after),
            opened_before=(
                _start_of(opened_on_or_before + timedelta(days=1))
                if opened_on_or_before is not None
                else None
            ),
            sort=sort,
            descending=descending,
            limit=limit,
            offset=offset,
        )
        items = [
            DealQueueItemView(
                id=deal.id,
                company_id=deal.company_id,
                company_name=company_name,
                company_journey=_value(journey),
                company_background_check=_value(background_check),
                reference=deal.reference,
                stage=deal.stage,
                buyer_name=buyer_name,
                buyer_country=buyer_country,
                handed_over_at=deal.handed_over_at,
                created_at=deal.created_at,
                updated_at=deal.updated_at,
                po_currency=po_currency,
                po_total=po_total,
                invoice_count=int(invoice_count or 0),
                invoiced_total=invoiced_total,
            )
            for (
                deal,
                company_name,
                journey,
                background_check,
                buyer_name,
                buyer_country,
                po_currency,
                po_total,
                invoice_count,
                invoiced_total,
            ) in rows
        ]
        return DealQueuePage(items=items, total=total, stage_counts=stage_counts)

    async def summary(
        self,
        *,
        period_start: datetime | None = None,
        period_end: datetime | None = None,
    ) -> DealSummaryView:
        """The KPI bar for ``[period_start, period_end)``; the last
        ``DEFAULT_PERIOD_DAYS`` days when neither is given."""
        end = period_end or datetime.now(UTC)
        start = period_start or end - timedelta(days=DEFAULT_PERIOD_DAYS)

        new_leads = await self._db.scalar(
            select(func.count())
            .select_from(ExporterProfile)
            .where(ExporterProfile.date_added >= start, ExporterProfile.date_added < end)
        )
        # A company that reached CUSTOMER, counted once however many rows say so.
        new_customers = await self._db.scalar(
            select(func.count(func.distinct(ExporterLifecycleHistory.customer_id))).where(
                ExporterLifecycleHistory.dimension == HISTORY_DIMENSION_JOURNEY,
                ExporterLifecycleHistory.to_status == ExporterJourney.CUSTOMER.value,
                ExporterLifecycleHistory.created_at >= start,
                ExporterLifecycleHistory.created_at < end,
            )
        )
        opened_in_period = (Deal.created_at >= start, Deal.created_at < end)
        deals_opened = await self._db.scalar(
            select(func.count()).select_from(Deal).where(*opened_in_period)
        )
        deals_opened_clear = await self._db.scalar(
            select(func.count())
            .select_from(Deal)
            .join(ExporterProfile, ExporterProfile.customer_id == Deal.company_id)
            .where(
                *opened_in_period,
                ExporterProfile.background_check == BackgroundCheckState.CLEAR,
            )
        )
        turnaround_seconds = await self._db.scalar(
            select(func.avg(func.extract("epoch", Deal.handed_over_at - Deal.created_at))).where(
                Deal.stage == DealStage.HANDED_OVER,
                Deal.handed_over_at >= start,
                Deal.handed_over_at < end,
            )
        )

        return DealSummaryView(
            period_start=start,
            period_end=end,
            stage_counts=await self._deals.count_by_stage(),
            new_leads=int(new_leads or 0),
            new_customers=int(new_customers or 0),
            deals_opened=int(deals_opened or 0),
            deals_opened_checks_clear=int(deals_opened_clear or 0),
            average_turnaround_days=(
                round(float(turnaround_seconds) / _SECONDS_PER_DAY, 1)
                if turnaround_seconds is not None
                else None
            ),
        )


def _start_of(day: date | None) -> datetime | None:
    """Midnight UTC at the start of ``day``."""
    return datetime.combine(day, time.min, tzinfo=UTC) if day is not None else None


def _value(member: object) -> str:
    """An enum column's value as a plain string — the read carries names, not this
    module's enum types, the way ``read_background_check`` does."""
    return str(getattr(member, "value", member))


__all__ = ["DEFAULT_PERIOD_DAYS", "DealQueueService"]
