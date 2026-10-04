"""Repository for ``deal`` — **owner: Developer 3B** (L3-05).

Mutable, unlike the append-only tables in this module: a deal's stage genuinely
changes, and the record of *how* it changed is a history row
(``dimension="deal"``), not a second deal row. So this extends
``BaseRepository`` — but note there is deliberately **no delete path used
anywhere**: ``WITHDRAWN`` is how a deal ends (deal contract §2), and the base
class's ``delete`` is simply never called.

The buyer is loaded with the deal (``lazy="selectin"`` on the relationship), so a
list of deals costs two statements rather than one per row.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Row, Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.onboarding.domain.deal_views import DealQueueSort
from app.modules.onboarding.domain.entities.deal import Deal
from app.modules.onboarding.domain.entities.deal_buyer import DealBuyer
from app.modules.onboarding.domain.entities.deal_enums import DealStage
from app.modules.onboarding.domain.entities.exporter_profile import ExporterProfile
from app.modules.onboarding.domain.entities.purchase_order import Invoice, PurchaseOrder
from app.platform.database.adapters.repository import BaseRepository


class DealRepository(BaseRepository[Deal]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Deal, session)

    async def get_by_id(self, deal_id: uuid.UUID) -> Deal | None:
        result = await self.session.execute(select(Deal).where(Deal.id == deal_id))
        return result.scalar_one_or_none()

    async def lock_by_id(self, deal_id: uuid.UUID) -> Deal | None:
        """The deal row, locked for the rest of the transaction and read fresh.

        Two concurrent stage moves are then judged one after the other, and the
        second sees the first — so the history can never show two moves out of the
        same stage. The same reason ``ConversationService._lock_profile`` and
        ``QualificationService`` lock.

        ``populate_existing`` matters as much as the lock: without it a row
        already in this session's identity map would be returned from memory, and
        the guard would judge a stale stage.
        """
        result = await self.session.execute(
            select(Deal)
            .where(Deal.id == deal_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        return result.scalar_one_or_none()

    def _for_company(self, company_id: uuid.UUID) -> Select[tuple[Deal]]:
        return select(Deal).where(Deal.company_id == company_id)

    async def list_for_company(
        self,
        company_id: uuid.UUID,
        *,
        stages: tuple[DealStage, ...] | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[Deal], int]:
        """One company's deals, newest first, with the total behind the page.

        Newest first because the deal someone is working on is almost always the
        one they just opened; ``ix_deal_company_recent`` serves exactly this.
        """
        statement = self._for_company(company_id)
        if stages:
            statement = statement.where(Deal.stage.in_(stages))

        total = await self.session.scalar(
            select(func.count()).select_from(statement.subquery())
        )
        result = await self.session.execute(
            statement.order_by(Deal.created_at.desc()).limit(limit).offset(offset)
        )
        return list(result.scalars().all()), int(total or 0)

    async def count_for_company(self, company_id: uuid.UUID) -> int:
        """How many deals a company has, at any stage.

        Used by the company panel's header, which wants the number without the
        rows.
        """
        total = await self.session.scalar(
            select(func.count()).select_from(Deal).where(Deal.company_id == company_id)
        )
        return int(total or 0)

    # ── The cross-company queue (the Deals list) ─────────────────────────

    def _queue(
        self,
        *,
        search: str | None,
        company_id: uuid.UUID | None,
        opened_from: datetime | None = None,
        opened_before: datetime | None = None,
    ) -> Select:
        """Every deal with its company's name, journey and background check and its
        buyer's name and country — one statement, however many rows.

        ``search`` matches the deal's reference, the company's name or the buyer's
        name, case-insensitively and literally (its own ``%`` and ``_`` are not
        wildcards). No identifier is searchable here: an exact-identifier match is
        an existence oracle, which is why that search is COMPLIANCE/ADMIN-only on
        the company list.
        """
        invoices = (
            select(
                Invoice.purchase_order_id,
                func.count(Invoice.id).label("count"),
                func.sum(Invoice.amount).label("total"),
            )
            .group_by(Invoice.purchase_order_id)
            .subquery()
        )
        statement = (
            select(
                Deal,
                ExporterProfile.name,
                ExporterProfile.journey,
                ExporterProfile.background_check,
                DealBuyer.name,
                DealBuyer.country,
                PurchaseOrder.currency,
                PurchaseOrder.total_amount,
                invoices.c.count,
                invoices.c.total,
            )
            .join(ExporterProfile, ExporterProfile.customer_id == Deal.company_id)
            .outerjoin(DealBuyer, DealBuyer.deal_id == Deal.id)
            # One PO per deal (`uq_purchase_order_deal_id`), and the invoices are
            # pre-aggregated per PO — neither join multiplies a deal's row.
            .outerjoin(PurchaseOrder, PurchaseOrder.deal_id == Deal.id)
            .outerjoin(invoices, invoices.c.purchase_order_id == PurchaseOrder.id)
        )
        if company_id is not None:
            statement = statement.where(Deal.company_id == company_id)
        if opened_from is not None:
            statement = statement.where(Deal.created_at >= opened_from)
        if opened_before is not None:
            statement = statement.where(Deal.created_at < opened_before)
        if search:
            pattern = f"%{_escape_like(search)}%"
            statement = statement.where(
                or_(
                    Deal.reference.ilike(pattern, escape="\\"),
                    ExporterProfile.name.ilike(pattern, escape="\\"),
                    DealBuyer.name.ilike(pattern, escape="\\"),
                )
            )
        return statement

    async def list_queue(
        self,
        *,
        stages: tuple[DealStage, ...] | None = None,
        search: str | None = None,
        company_id: uuid.UUID | None = None,
        opened_from: datetime | None = None,
        opened_before: datetime | None = None,
        sort: DealQueueSort = DealQueueSort.UPDATED_AT,
        descending: bool = True,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[Row], int, dict[DealStage, int]]:
        """A page of the queue, the total behind it, and the count per stage.

        The per-stage counts ignore ``stages`` and honour everything else, so a
        stage tab can say how many rows it would show before it is picked.
        """
        base = self._queue(
            search=search,
            company_id=company_id,
            opened_from=opened_from,
            opened_before=opened_before,
        )

        filtered = base.with_only_columns(Deal.stage).subquery()
        counted = await self.session.execute(
            select(filtered.c.stage, func.count()).group_by(filtered.c.stage)
        )
        stage_counts = {stage: 0 for stage in DealStage}
        for stage, count in counted.all():
            stage_counts[DealStage(stage)] = int(count)

        statement = base.where(Deal.stage.in_(stages)) if stages else base
        total = sum(stage_counts[stage] for stage in stages) if stages else sum(
            stage_counts.values()
        )

        column = {
            DealQueueSort.CREATED_AT: Deal.created_at,
            DealQueueSort.UPDATED_AT: Deal.updated_at,
            DealQueueSort.REFERENCE: func.lower(Deal.reference),
            DealQueueSort.COMPANY_NAME: func.lower(ExporterProfile.name),
            DealQueueSort.STAGE: Deal.stage,
        }[sort]
        order = column.desc().nulls_last() if descending else column.asc().nulls_last()
        # `Deal.id` last, so equal keys still page in a stable order.
        result = await self.session.execute(
            statement.order_by(order, Deal.id).limit(limit).offset(offset)
        )
        return list(result.all()), total, stage_counts

    async def count_by_stage(self) -> dict[DealStage, int]:
        """Every deal, counted per stage — the KPI bar's stage figures."""
        result = await self.session.execute(
            select(Deal.stage, func.count()).group_by(Deal.stage)
        )
        counts = {stage: 0 for stage in DealStage}
        for stage, count in result.all():
            counts[DealStage(stage)] = int(count)
        return counts


def _escape_like(value: str) -> str:
    """`value` for a LIKE pattern with a backslash as the escape character, so its
    own `%`, `_` and backslashes are matched literally — the same rule as
    `exporter_profile_repository._escape_like`."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
