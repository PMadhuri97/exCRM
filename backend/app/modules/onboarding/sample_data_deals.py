"""Sample data for deals, buyers and documents — **owner: Developer 3B**
(L3-05 … L3-10).

Called from ``sample_data.py``'s hooks, after every sample company exists (a deal
hangs off a company) and after the background-check hook (company B must be a
``CUSTOMER`` with a ``CLEAR`` check before its deal can be handed over).

Architecture §3.9 gives company B two deals, one handed over, and company C one
open deal that cannot be handed over because its background check is flagged —
each sample company's target is recorded on ``SampleCompany.target``.

**Every state is reached through the service, never written.** B's deal is handed
over by ``DealService.transition_stage``, so assumption A5's guard really passes (B
is a ``CUSTOMER`` and ``CLEAR``) and the handover writes its history row and its
announcement like any other. C's deal stays ``OPEN``; the guard would refuse it.

Converges like every other seeder: it looks at what is there, adds only what is
missing, moves a deal forward only when it is behind its target, and reports zero on
a repeat run.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

import structlog

from app.modules.onboarding.application.deal_service import DealService
from app.modules.onboarding.application.purchase_order_service import PurchaseOrderService
from app.modules.onboarding.domain.entities.deal_enums import DealStage
from app.platform.database import services as db_services

logger = structlog.get_logger(__name__)


@dataclass(frozen=True)
class _SamplePaperwork:
    """The deal's purchase order and its invoices (build prompt chunk 2) —
    number, date, currency and amount each, as an operator would key them in."""

    po_number: str
    po_date: date
    currency: str
    total: Decimal
    #: (invoice number, invoice date, amount) — one or more.
    invoices: tuple[tuple[str, date, Decimal], ...]


class _SampleDeal:
    """One deal to bring into being, with its buyer, its paperwork and the stage to
    leave it at."""

    def __init__(
        self,
        *,
        reference: str,
        buyer_name: str,
        buyer_country: str,
        paperwork: _SamplePaperwork,
        stage: DealStage = DealStage.OPEN,
        buyer_registration_number: str | None = None,
    ) -> None:
        self.reference = reference
        self.buyer_name = buyer_name
        self.buyer_country = buyer_country
        self.paperwork = paperwork
        self.stage = stage
        self.buyer_registration_number = buyer_registration_number


#: Keyed by the sample company's slug, from ``sample_data.COMPANIES``.
SAMPLE_DEALS: dict[str, tuple[_SampleDeal, ...]] = {
    # §3.9 company B: two deals. The second is the one §3.9 calls "handed over";
    # the first is still gathering its paperwork.
    "company-b": (
        _SampleDeal(
            reference="Rotterdam shipment, March",
            buyer_name="Rotterdam Trading BV",
            buyer_country="NL",
            buyer_registration_number="NL-8899-221",
            stage=DealStage.GATHERING_PAPERWORK,
            # One order split across two invoices — the tax case chunk 2 names.
            paperwork=_SamplePaperwork(
                po_number="RTB-PO-24-0311",
                po_date=date(2026, 3, 4),
                currency="EUR",
                total=Decimal("84000.00"),
                invoices=(
                    ("BPM-INV-0311-A", date(2026, 3, 18), Decimal("50000.00")),
                    ("BPM-INV-0311-B", date(2026, 3, 25), Decimal("34000.00")),
                ),
            ),
        ),
        _SampleDeal(
            reference="Hamburg order, April",
            buyer_name="Hanseatic Industrie GmbH",
            buyer_country="DE",
            buyer_registration_number="HRB-77321",
            stage=DealStage.HANDED_OVER,
            paperwork=_SamplePaperwork(
                po_number="HIG-4471",
                po_date=date(2026, 4, 2),
                currency="EUR",
                total=Decimal("126500.00"),
                invoices=(("BPM-INV-0402", date(2026, 4, 20), Decimal("126500.00")),),
            ),
        ),
    ),
    # §3.9 company C: one open deal that cannot be handed over. It is left gathering
    # its paperwork, with its buyer, so the handover is the next move and the deal
    # page shows why it is refused: C is a PROSPECT and its check is FLAGGED.
    "company-c": (
        _SampleDeal(
            reference="Dubai seafood order",
            buyer_name="Gulf Fresh Foods LLC",
            buyer_country="AE",
            stage=DealStage.GATHERING_PAPERWORK,
            # Partly invoiced so far — what is left shows on the deal.
            paperwork=_SamplePaperwork(
                po_number="GFF/PO/2026/118",
                po_date=date(2026, 8, 11),
                currency="USD",
                total=Decimal("212000.00"),
                invoices=(("CSE-EXP-2026-0091", date(2026, 8, 30), Decimal("140000.00")),),
            ),
        ),
    ),
}


async def load_deal_sample_data() -> int:
    """Bring each sample company's deals to their §3.9 state.

    Returns the number of deals this run created — ``0`` on a repeat run.
    """
    # Imported here rather than at module scope: `sample_data` imports this
    # module, so a module-scope import back into it would be a cycle.
    from app.modules.onboarding.sample_data import COMPANIES

    slugs = {company.slug: company.customer_id for company in COMPANIES}
    created = 0

    for slug, deals in SAMPLE_DEALS.items():
        company_id = slugs.get(slug)
        if company_id is None:  # pragma: no cover - a renamed sample company
            logger.warning("sample_deals.company_missing", slug=slug)
            continue
        for deal in deals:
            if await _ensure_deal(company_id, deal):
                created += 1

    return created


async def _ensure_deal(company_id: uuid.UUID, sample: _SampleDeal) -> bool:
    """Create one deal, its buyer and its stage, unless a deal with that
    reference is already there — in which case an ``OPEN`` one is only moved on to
    the stage this file now asks for, so a database seeded by an earlier version
    converges instead of keeping an outdated state. Returns whether it created one."""
    async with db_services.AsyncSessionLocal() as db:
        existing, _ = await DealService(db).list_for_company(company_id, limit=200)
    found = next((view for view in existing if view.reference == sample.reference), None)
    if found is not None:
        if not found.stage.is_terminal:
            await _ensure_paperwork(found.id, sample.paperwork)
        if found.stage is DealStage.OPEN and sample.stage is not DealStage.OPEN:
            async with db_services.AsyncSessionLocal() as db:
                await DealService(db).transition_stage(
                    found.id, DealStage.GATHERING_PAPERWORK, actor_id=None
                )
            logger.info(
                "sample_deals.advanced",
                company_id=str(company_id),
                deal_id=str(found.id),
                reference=sample.reference,
            )
        return False

    async with db_services.AsyncSessionLocal() as db:
        view = await DealService(db).open_deal(
            company_id, reference=sample.reference, actor_id=None
        )
    async with db_services.AsyncSessionLocal() as db:
        await DealService(db).set_buyer(
            view.id,
            name=sample.buyer_name,
            country=sample.buyer_country,
            registration_number=sample.buyer_registration_number,
            actor_id=None,
        )
    await _ensure_paperwork(view.id, sample.paperwork)
    # One stage at a time, as a person would: a deal bound for HANDED_OVER stops at
    # GATHERING_PAPERWORK here, and `hand_over_sample_deals` makes the last move.
    stage = (
        DealStage.GATHERING_PAPERWORK if sample.stage is DealStage.HANDED_OVER else sample.stage
    )
    if stage is not DealStage.OPEN:
        async with db_services.AsyncSessionLocal() as db:
            await DealService(db).transition_stage(view.id, stage, actor_id=None)

    logger.info(
        "sample_deals.created",
        company_id=str(company_id),
        deal_id=str(view.id),
        reference=sample.reference,
        stage=stage.value,
    )
    return True


async def _ensure_paperwork(deal_id: uuid.UUID, paperwork: _SamplePaperwork) -> None:
    """Record the deal's PO and any of its invoices not yet there — through
    ``PurchaseOrderService``, as an operator would, and idempotently."""
    async with db_services.AsyncSessionLocal() as db:
        current = await PurchaseOrderService(db).get(deal_id)
    if current is None:
        async with db_services.AsyncSessionLocal() as db:
            current = await PurchaseOrderService(db).set_purchase_order(
                deal_id,
                po_number=paperwork.po_number,
                po_date=paperwork.po_date,
                currency=paperwork.currency,
                total_amount=paperwork.total,
                payment_terms="60 days from invoice",
                source_document_id=None,
                actor_id=None,
            )
    have = {invoice.invoice_number for invoice in current.invoices}
    for number, issued, amount in paperwork.invoices:
        if number in have:
            continue
        async with db_services.AsyncSessionLocal() as db:
            await PurchaseOrderService(db).add_invoice(
                deal_id,
                invoice_number=number,
                invoice_date=issued,
                due_date=issued + timedelta(days=60),
                amount=amount,
                currency=None,
                source_document_id=None,
                actor_id=None,
            )


async def hand_over_sample_deals() -> int:
    """Hand over every sample deal whose target is ``HANDED_OVER`` and that is ready
    for it — through ``DealService``, so assumption A5's guard decides.

    Returns the number of deals handed over by this run — ``0`` on a repeat run. A
    deal the guard refuses (its company not yet a ``CUSTOMER`` with a ``CLEAR`` check)
    is left where it is and logged; nothing is forced.
    """
    from app.modules.onboarding.exceptions import DealHandoverBlockedError
    from app.modules.onboarding.sample_data import COMPANIES

    slugs = {company.slug: company.customer_id for company in COMPANIES}
    handed_over = 0
    for slug, deals in SAMPLE_DEALS.items():
        company_id = slugs.get(slug)
        if company_id is None:  # pragma: no cover - a renamed sample company
            continue
        async with db_services.AsyncSessionLocal() as db:
            existing, _ = await DealService(db).list_for_company(company_id, limit=200)
        by_reference = {view.reference: view for view in existing}
        for sample in deals:
            view = by_reference.get(sample.reference)
            if (
                sample.stage is not DealStage.HANDED_OVER
                or view is None
                or view.stage is not DealStage.GATHERING_PAPERWORK
            ):
                continue
            try:
                async with db_services.AsyncSessionLocal() as db:
                    await DealService(db).transition_stage(
                        view.id, DealStage.HANDED_OVER, actor_id=None
                    )
            except DealHandoverBlockedError as blocked:
                logger.warning(
                    "sample_deals.handover_blocked", deal_id=str(view.id), reason=blocked.detail
                )
                continue
            handed_over += 1
    return handed_over


__all__ = ["hand_over_sample_deals", "load_deal_sample_data"]
