"""Saved lists — build prompt chunk 3; Centrex §4 ("Dynamic List Builder / Work
Queues").

Revision ID: onboarding_0024_saved_list
Revises: onboarding_0023_po_invoice

A saved list is a named, reusable view over the Deals or the Companies list:
its filters, its columns and its sort. It holds **no rows** — opening one asks the
ordinary list endpoint with the viewer's own role, so masking and the D8 rule
apply to whoever is looking, whoever built the list. Records move on and off a
list as they change, which is what makes it a live work queue rather than a
report.

Sharing (settled 30 September 2026): every list is visible to every CRM reader;
only ADMIN and DEVELOPER create them. That rule is the route's; the table records
who created each list so the creator (or an ADMIN) may change it.

``filters`` and ``columns`` are JSONB, validated against the object type by the
service before they are written — the shapes are the list endpoints' own
parameters, so a saved list can never ask for a filter the endpoint does not have.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "onboarding_0024_saved_list"
down_revision: str | None = "onboarding_0023_po_invoice"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "onboarding"


def upgrade() -> None:
    op.create_table(
        "saved_list",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("object_type", sa.String(length=20), nullable=False),
        sa.Column("filters", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("columns", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("sort", sa.String(length=40), nullable=True),
        sa.Column("sort_order", sa.String(length=4), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "object_type IN ('DEALS', 'COMPANIES')", name="ck_saved_list_object_type"
        ),
        sa.CheckConstraint("btrim(name) <> ''", name="ck_saved_list_name_present"),
        sa.CheckConstraint(
            "sort_order IS NULL OR sort_order IN ('asc', 'desc')", name="ck_saved_list_sort_order"
        ),
        # Two lists of one kind with the same name would be two tabs nobody can
        # tell apart.
        sa.UniqueConstraint("object_type", "name", name="uq_saved_list_type_name"),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_table("saved_list", schema=SCHEMA)
