"""Purchase orders and their invoices — build prompt chunk 2.

Revision ID: onboarding_0023_po_invoice
Revises: auth_0005_financer_role

The structure ANER settled on (30 September 2026): an **deal** (a ``deal``) is
backed by exactly one **purchase order**, and the PO by **one or more invoices** —
exporters often split one order into several invoices for tax reasons. At least
one invoice is required before a deal may be handed over; that rule is the
service's (``DealService._handover_blocked_reason``), because "none yet" is a
legal state while the paperwork is being gathered.

What it adds, all in the ``onboarding`` schema:

* ``purchase_order`` — one per deal (``uq_purchase_order_deal_id``), its number,
  date, ISO-4217 currency, total and payment terms, and optionally the uploaded
  document it was read from (``source_document_id``).
* ``invoice`` — many per PO, numbers unique within the PO
  (``uq_invoice_po_number``), each with its date, optional due date, amount, and
  optionally its own source document. An invoice is in the PO's currency; the
  service checks that, the column records it so a later check need not join.

Amounts are ``NUMERIC(18, 2)``: money is never a float. Both foreign keys to the
deal side ``CASCADE`` from their parent the way ``deal_buyer`` does — a PO has no
meaning without its deal, an invoice none without its PO — though a deal is never
deleted anyway. The source-document keys ``RESTRICT``: a document a PO was read
from must not vanish from under it.

Downgrade drops both tables, losing every PO and invoice — lossy, so only if you
mean it. The history rows that recorded them survive, as strings.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "onboarding_0023_po_invoice"
down_revision: str | None = "auth_0005_financer_role"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "onboarding"


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "purchase_order",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("deal_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("po_number", sa.String(length=100), nullable=False),
        sa.Column("po_date", sa.Date(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("total_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("payment_terms", sa.Text(), nullable=True),
        sa.Column("source_document_id", postgresql.UUID(as_uuid=True), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["deal_id"], [f"{SCHEMA}.deal.id"], name="fk_purchase_order_deal_id", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["source_document_id"],
            [f"{SCHEMA}.crm_document.id"],
            name="fk_purchase_order_source_document_id",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("deal_id", name="uq_purchase_order_deal_id"),
        sa.CheckConstraint("currency ~ '^[A-Z]{3}$'", name="ck_purchase_order_currency_iso"),
        sa.CheckConstraint("total_amount > 0", name="ck_purchase_order_total_positive"),
        sa.CheckConstraint("btrim(po_number) <> ''", name="ck_purchase_order_number_present"),
        schema=SCHEMA,
    )

    op.create_table(
        "invoice",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("purchase_order_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("invoice_number", sa.String(length=100), nullable=False),
        sa.Column("invoice_date", sa.Date(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("source_document_id", postgresql.UUID(as_uuid=True), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["purchase_order_id"],
            [f"{SCHEMA}.purchase_order.id"],
            name="fk_invoice_purchase_order_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["source_document_id"],
            [f"{SCHEMA}.crm_document.id"],
            name="fk_invoice_source_document_id",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("purchase_order_id", "invoice_number", name="uq_invoice_po_number"),
        sa.CheckConstraint("currency ~ '^[A-Z]{3}$'", name="ck_invoice_currency_iso"),
        sa.CheckConstraint("amount > 0", name="ck_invoice_amount_positive"),
        sa.CheckConstraint("btrim(invoice_number) <> ''", name="ck_invoice_number_present"),
        sa.CheckConstraint(
            "due_date IS NULL OR due_date >= invoice_date", name="ck_invoice_due_after_issue"
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_invoice_purchase_order", "invoice", ["purchase_order_id", "invoice_date"], schema=SCHEMA
    )


def downgrade() -> None:
    op.drop_index("ix_invoice_purchase_order", table_name="invoice", schema=SCHEMA)
    op.drop_table("invoice", schema=SCHEMA)
    op.drop_table("purchase_order", schema=SCHEMA)
