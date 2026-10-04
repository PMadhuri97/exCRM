"""``SavedList`` — a named, reusable view over the Deals or Companies list
(build prompt chunk 3; Centrex §4; migration ``onboarding_0024_saved_list``).

A definition only — filters, columns, sort — never rows. Opening a list asks the
ordinary list endpoint with the viewer's own role, so whoever built it, masking
and decision D8 apply to whoever is looking.
"""

from __future__ import annotations

import enum
import uuid

from sqlalchemy import CheckConstraint, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.database.models import AnerModel

SCHEMA = "onboarding"


class SavedListObject(str, enum.Enum):
    """Which list a saved list is a view over."""

    DEALS = "DEALS"
    COMPANIES = "COMPANIES"


class SavedList(AnerModel):
    __tablename__ = "saved_list"
    __table_args__ = (
        CheckConstraint("object_type IN ('DEALS', 'COMPANIES')", name="ck_saved_list_object_type"),
        CheckConstraint("btrim(name) <> ''", name="ck_saved_list_name_present"),
        CheckConstraint(
            "sort_order IS NULL OR sort_order IN ('asc', 'desc')", name="ck_saved_list_sort_order"
        ),
        UniqueConstraint("object_type", "name", name="uq_saved_list_type_name"),
        {"schema": SCHEMA},
    )

    name: Mapped[str] = mapped_column(String(80), nullable=False)
    #: A `SavedListObject` value, stored as text (`ck_saved_list_object_type`).
    object_type: Mapped[str] = mapped_column(String(20), nullable=False)
    #: The list endpoint's own parameters, validated per object type by the service.
    filters: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    #: Column ids, in order. Empty means the list's defaults.
    columns: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    sort: Mapped[str | None] = mapped_column(String(40), nullable=True)
    sort_order: Mapped[str | None] = mapped_column(String(4), nullable=True)
    #: Who built it — they (or an ADMIN) may change or delete it.
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)


__all__ = ["SavedList", "SavedListObject"]
