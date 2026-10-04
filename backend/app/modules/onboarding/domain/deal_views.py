"""Read-model view types for deals and buyers — **owner: Developer 3B** (L3-05,
L3-06).

Pure data structures — no I/O, no session — the same pattern as
``engagement_views.py`` and ``exporter_profile_views.py``. ``DealService``
assembles them.

``DealStageMove`` is the rules as data: the screen asks the server which moves it
may offer rather than keeping a copy of the table (§7.5, deal contract §4.1), so
a rule change here cannot leave a stale button behind in ``DealDetailPage.tsx``.
"""

from __future__ import annotations

import enum
import uuid
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from app.modules.onboarding.domain.entities.deal_enums import DealStage


@dataclass(frozen=True)
class DealBuyerView:
    id: uuid.UUID
    deal_id: uuid.UUID
    name: str
    country: str
    registration_number: str | None
    tax_id: str | None
    contact_email: str | None
    contact_phone: str | None


@dataclass(frozen=True)
class DealStageMove:
    """One move this viewer may make, and what it needs.

    ``reason_required`` lets the screen ask for the withdrawal reason *before*
    submitting, rather than showing a 422 afterwards.
    """

    to: DealStage
    reason_required: bool


@dataclass(frozen=True)
class DealView:
    """One deal, its buyer, and what may be done to it next."""

    id: uuid.UUID
    company_id: uuid.UUID
    reference: str
    stage: DealStage
    withdrawal_reason: str | None
    handed_over_at: datetime | None
    created_at: datetime
    updated_at: datetime
    buyer: DealBuyerView | None
    allowed_stage_moves: tuple[DealStageMove, ...]
    #: Why the handover is not on offer, when it is not: "the company is not a
    #: CUSTOMER", "the background check is not CLEAR", or — while Developer 4's
    #: migration 0015 is missing — "the background check is not recorded yet".
    #: ``None`` when the handover *is* available, or when the deal is nowhere near
    #: it. The screen explains instead of offering a button that 409s
    #: (deal contract §4.1).
    handover_blocked_reason: str | None


@dataclass(frozen=True)
class DealListItemView:
    """One row of a company's deal list.

    Carries the buyer's name rather than the whole buyer: a list wants something
    readable per row, and the full buyer is one request away.
    """

    id: uuid.UUID
    company_id: uuid.UUID
    reference: str
    stage: DealStage
    buyer_name: str | None
    created_at: datetime
    updated_at: datetime


class DealQueueSort(str, enum.Enum):
    """What the cross-company deal queue may be ordered by.

    A closed set rather than a column name from the request, so a caller can never
    sort on a column this read does not mean to expose.
    """

    CREATED_AT = "created_at"
    UPDATED_AT = "updated_at"
    REFERENCE = "reference"
    COMPANY_NAME = "company_name"
    STAGE = "stage"


@dataclass(frozen=True)
class DealQueueItemView:
    """One row of the cross-company deal queue (the Deals list).

    Centrex §5 ("Contact List / Operational Workbench"): the key status fields sit
    on the row, so a reader can triage without opening every deal. Company and
    buyer are carried by name only — the full records are one click away, and
    nothing here is an identifier that masking would have to touch.
    """

    id: uuid.UUID
    company_id: uuid.UUID
    company_name: str | None
    company_journey: str
    #: The company's background check. The route drops it for DEVELOPER (D8).
    company_background_check: str
    reference: str
    stage: DealStage
    buyer_name: str | None
    buyer_country: str | None
    #: When the deal was handed over; ``None`` until then, and forever on a
    #: withdrawn deal. Lets the list say how long a deal took, not only how
    #: long it has been open.
    handed_over_at: datetime | None
    created_at: datetime
    updated_at: datetime
    #: The deal's purchase order, when recorded (build prompt chunk 2): its
    #: currency and total, how many invoices, and their sum. ``None`` / ``0`` before.
    po_currency: str | None = None
    po_total: Decimal | None = None
    invoice_count: int = 0
    invoiced_total: Decimal | None = None


@dataclass(frozen=True)
class DealQueuePage:
    """A page of the queue, the total behind it, and the live count per stage.

    ``stage_counts`` honours every filter except the stage one, so each stage tab
    can show how many rows it would hold — Centrex §4's "records move on and off
    lists when their status changes", as a number on the tab.
    """

    items: list[DealQueueItemView]
    total: int
    stage_counts: dict[DealStage, int]


@dataclass(frozen=True)
class DealSummaryView:
    """The KPI bar over the Deals list, computed on the server.

    Every figure is a count or a duration the database already holds. There is
    no open value: a deal carries no amount or currency yet, and which field
    will is waiting on the PO/invoice work (build prompt, chunk 2).
    """

    period_start: datetime
    period_end: datetime
    stage_counts: dict[DealStage, int]
    #: Companies added in the period, at any journey.
    new_leads: int
    #: Companies that reached ``CUSTOMER`` in the period (journey history rows).
    new_customers: int
    #: Deals opened in the period, and how many of those belong to a company
    #: whose background check is ``CLEAR`` now.
    deals_opened: int
    deals_opened_checks_clear: int
    #: Mean days from opening to handover, over deals handed over in the period;
    #: ``None`` when none were.
    average_turnaround_days: float | None
