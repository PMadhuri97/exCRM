"""Logging a call — Centrex §6 ("Call Tracking and Follow-up").

Centrex's call pop-up does three things in one save: records the call (who, which
way, how it went, how long, notes), optionally updates the record's status, and
optionally schedules a follow-up call. Here that is:

* the call — a ``CALL`` activity with migration 0025's call fields;
* the status — the conversation gauge (READY_NOW, NOT_NOW, …), moved through
  ``ConversationService`` with every one of its rules, never assigned here. The
  journey is not a status a call can move: a qualification outcome or the
  background check moves it;
* the follow-up — a ``FOLLOW_UP`` activity due when asked, which lands on the
  Follow-ups page for the person who logged it.

**All of it commits together or not at all.** A refused status move (a LEAD has no
conversation gauge; NOT_NOW needs a reason and a check-back date) leaves no call
logged either, so the person fixes the move and saves once.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.onboarding.application.conversation_service import ConversationService
from app.modules.onboarding.domain.entities.engagement_enums import (
    CallDirection,
    CallResult,
    ExporterActivityType,
    ExporterConversation,
)
from app.modules.onboarding.domain.entities.exporter_activity import ExporterActivity
from app.modules.onboarding.domain.entities.exporter_contact import ExporterContact
from app.modules.onboarding.domain.entities.exporter_profile import ExporterProfile
from app.modules.onboarding.exceptions import ExporterProfileNotFoundError
from app.shared.exceptions import ValidationError

_DIRECTION_WORD = {CallDirection.OUTBOUND: "Outgoing call", CallDirection.INBOUND: "Incoming call"}
_RESULT_WORD = {
    CallResult.CONNECTED: "connected",
    CallResult.NO_ANSWER: "no answer",
    CallResult.VOICEMAIL: "left a voicemail",
    CallResult.BUSY: "busy",
    CallResult.WRONG_NUMBER: "wrong number",
    CallResult.CALL_BACK_REQUESTED: "asked to be called back",
}


@dataclass(frozen=True)
class StatusMove:
    """Where the conversation gauge should go, with what that move needs."""

    to: ExporterConversation
    reason: str | None = None
    check_back_on: date | None = None


@dataclass(frozen=True)
class LoggedCall:
    call: ExporterActivity
    follow_up: ExporterActivity | None
    conversation: ExporterConversation | None


class CallLogService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def log_call(
        self,
        customer_id: uuid.UUID,
        *,
        direction: CallDirection,
        result: CallResult,
        duration_seconds: int,
        notes: str | None,
        contact_id: uuid.UUID | None,
        actor_id: str,
        status: StatusMove | None = None,
        follow_up_at: datetime | None = None,
        follow_up_subject: str | None = None,
    ) -> LoggedCall:
        company = await self._db.scalar(
            select(ExporterProfile).where(ExporterProfile.customer_id == customer_id)
        )
        if company is None:
            raise ExporterProfileNotFoundError(customer_id)
        if duration_seconds < 0:
            raise ValidationError("a call cannot last less than no time")

        contact = None
        if contact_id is not None:
            contact = await self._db.scalar(
                select(ExporterContact).where(
                    ExporterContact.id == contact_id, ExporterContact.customer_id == customer_id
                )
            )
            if contact is None:
                raise ValidationError("that contact is not one of this company's")

        now = datetime.now(UTC)
        if follow_up_at is not None and follow_up_at <= now:
            raise ValidationError("a follow-up is scheduled for later, not for the past")

        # The status move first: it is the step with rules, and a refusal here must
        # leave nothing behind — it flushes, and the commit below makes it real.
        moved: ExporterConversation | None = None
        if status is not None:
            await ConversationService(self._db).set_conversation(
                customer_id,
                status.to,
                reason=status.reason,
                check_back_on=status.check_back_on,
                actor_id=actor_id,
                commit=False,
            )
            moved = status.to

        who = f" {'to' if direction is CallDirection.OUTBOUND else 'from'} {contact.name}" if contact else ""
        call = ExporterActivity(
            customer_id=customer_id,
            activity_type=ExporterActivityType.CALL,
            subject=f"{_DIRECTION_WORD[direction]}{who} — {_RESULT_WORD[result]}",
            notes=(notes or "").strip() or None,
            actor_id=actor_id,
            occurred_at=now,
            call_direction=direction.value,
            call_result=result.value,
            call_duration_seconds=duration_seconds,
            contact_id=contact.id if contact else None,
        )
        self._db.add(call)

        follow_up = None
        if follow_up_at is not None:
            follow_up = ExporterActivity(
                customer_id=customer_id,
                activity_type=ExporterActivityType.FOLLOW_UP,
                subject=(follow_up_subject or "").strip()
                or (f"Call {contact.name} back" if contact else "Follow-up call"),
                notes=None,
                actor_id=actor_id,
                occurred_at=now,
                due_at=follow_up_at,
            )
            self._db.add(follow_up)

        await self._db.commit()
        await self._db.refresh(call)
        if follow_up is not None:
            await self._db.refresh(follow_up)
        return LoggedCall(call=call, follow_up=follow_up, conversation=moved)


__all__ = ["CallLogService", "LoggedCall", "StatusMove"]
