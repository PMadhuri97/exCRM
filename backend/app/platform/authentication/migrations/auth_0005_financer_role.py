"""Add FINANCER to user_role_enum, and seed it as a built-in role

The underwriter and the financier are one person in this business, so they are
one role. Build prompt chunk 6 names it FINANCER; it reads the whole CRM —
including the background check, screening and verification results an
underwriting view needs — and writes nothing yet. Its decision panel comes later.

Two steps, following the two migrations this one copies:

- The enum value, inside an autocommit block exactly as ``auth_0002_developer_role``
  does: Postgres refuses to let a label added by ``ALTER TYPE ... ADD VALUE`` be
  referenced before that statement has committed.
- The built-in ``auth.role`` row and its permissions, as ``auth_0004_rbac`` seeded
  the other five. **Transcribed, not imported** from ``catalog.py`` — a data
  migration must keep applying what was true when it was written. Idempotent: a
  database that already holds the row is left as it is, so an administrator's
  edits to it survive a re-run.

Revision ID: auth_0005_financer_role
Revises: onboarding_0022_integrity
Create Date: 2026-09-30
"""

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "auth_0005_financer_role"
down_revision: str | None = "onboarding_0022_integrity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "auth"

ROLE = (
    "FINANCER",
    "financer",
    "Financer",
    "Underwriting and financing. Reads every company and deal, including "
    "background checks and verification results; tax identifiers are masked.",
)

PERMISSIONS = [
    ("exporters", "view"),
    ("verifications", "view"),
    ("screening", "view"),
]


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(f"ALTER TYPE {SCHEMA}.user_role_enum ADD VALUE IF NOT EXISTS 'FINANCER'")

    builtin, slug, name, description = ROLE
    connection = op.get_bind()
    exists = connection.execute(
        sa.text(f"SELECT 1 FROM {SCHEMA}.role WHERE builtin_role = :builtin OR slug = :slug"),
        {"builtin": builtin, "slug": slug},
    ).first()
    if exists:
        return

    role_id = uuid.uuid4()
    connection.execute(
        sa.text(
            f"INSERT INTO {SCHEMA}.role (id, slug, name, description, builtin_role, is_assignable)"
            " VALUES (:id, :slug, :name, :description, :builtin, true)"
        ),
        {"id": role_id, "slug": slug, "name": name, "description": description, "builtin": builtin},
    )
    for module, action in PERMISSIONS:
        connection.execute(
            sa.text(
                f"INSERT INTO {SCHEMA}.role_permission (id, role_id, module, action)"
                " VALUES (:id, :role_id, :module, :action)"
            ),
            {"id": uuid.uuid4(), "role_id": role_id, "module": module, "action": action},
        )


def downgrade() -> None:
    # The role row goes (its permissions cascade); `fk_users_role_id_role` is
    # RESTRICT, so this refuses while any account still holds it — nobody is
    # silently demoted. The enum value stays: Postgres cannot drop one without
    # recreating the type, the non-goal every enum-add migration here accepts.
    op.execute(f"DELETE FROM {SCHEMA}.role WHERE builtin_role = 'FINANCER'")
