"""Call details on a logged call — Centrex §6 ("Call Tracking and Follow-up").

Revision ID: onboarding_0025_call_details
Revises: onboarding_0024_saved_list

A ``CALL`` activity could only say "a call happened" with free text. Centrex's call
pop-up records *how* it went, and so does this: four nullable columns on
``exporter_activity``.

* ``call_direction`` — ``OUTBOUND`` or ``INBOUND``.
* ``call_result`` — ``CONNECTED``, ``NO_ANSWER``, ``VOICEMAIL``, ``BUSY``,
  ``WRONG_NUMBER`` or ``CALL_BACK_REQUESTED``.
* ``call_duration_seconds`` — zero or more.
* ``contact_id`` — who was called, a real foreign key to ``exporter_contact``
  (``RESTRICT``: contacts are never deleted, and the table is append-only, so the
  link could not be cleared anyway).

``ck_exporter_activity_call_fields`` keeps them on calls only: any other activity
has all four empty. Calls logged before this migration simply have them empty too,
so the constraint does not demand them of a ``CALL`` — the new call route does.

The table stays append-only (``trg_exporter_activity_append_only``): adding
columns is DDL, not an update of any row.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "onboarding_0025_call_details"
down_revision: str | None = "onboarding_0024_saved_list"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "onboarding"

CALL_RESULTS = ("CONNECTED", "NO_ANSWER", "VOICEMAIL", "BUSY", "WRONG_NUMBER", "CALL_BACK_REQUESTED")


def upgrade() -> None:
    op.add_column("exporter_activity", sa.Column("call_direction", sa.String(8)), schema=SCHEMA)
    op.add_column("exporter_activity", sa.Column("call_result", sa.String(24)), schema=SCHEMA)
    op.add_column("exporter_activity", sa.Column("call_duration_seconds", sa.Integer()), schema=SCHEMA)
    op.add_column(
        "exporter_activity",
        sa.Column("contact_id", postgresql.UUID(as_uuid=True)),
        schema=SCHEMA,
    )
    op.create_foreign_key(
        "fk_exporter_activity_contact_id",
        "exporter_activity",
        "exporter_contact",
        ["contact_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
        ondelete="RESTRICT",
    )
    results = ", ".join(f"'{value}'" for value in CALL_RESULTS)
    op.create_check_constraint(
        "ck_exporter_activity_call_fields",
        "exporter_activity",
        "(activity_type = 'CALL'"
        " AND (call_direction IS NULL OR call_direction IN ('OUTBOUND', 'INBOUND'))"
        f" AND (call_result IS NULL OR call_result IN ({results}))"
        " AND (call_duration_seconds IS NULL OR call_duration_seconds >= 0))"
        " OR (activity_type <> 'CALL' AND call_direction IS NULL AND call_result IS NULL"
        " AND call_duration_seconds IS NULL AND contact_id IS NULL)",
        schema=SCHEMA,
    )
    op.create_index(
        "ix_exporter_activity_contact_id",
        "exporter_activity",
        ["contact_id"],
        schema=SCHEMA,
        postgresql_where=sa.text("contact_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_exporter_activity_contact_id", table_name="exporter_activity", schema=SCHEMA)
    op.drop_constraint(
        "ck_exporter_activity_call_fields", "exporter_activity", schema=SCHEMA, type_="check"
    )
    op.drop_constraint(
        "fk_exporter_activity_contact_id", "exporter_activity", schema=SCHEMA, type_="foreignkey"
    )
    for column in ("contact_id", "call_duration_seconds", "call_result", "call_direction"):
        op.drop_column("exporter_activity", column, schema=SCHEMA)
