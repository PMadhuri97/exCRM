"""Request/response schemas for saved lists — build prompt chunk 3.

A list's ``filters`` are validated against its object type here, with the very
parameters its list endpoint takes (``GET /deals`` for DEALS, ``GET
/exporters`` for COMPANIES), so a saved list can never ask for a filter the
endpoint does not have — and never for an identifier search, which stays
COMPLIANCE/ADMIN-only on the endpoint itself.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated, Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.modules.onboarding.domain.deal_views import DealQueueSort
from app.modules.onboarding.domain.entities.deal_enums import DealStage
from app.modules.onboarding.domain.entities.exporter_enums import (
    ExporterJourney,
    ExporterMarker,
    ExporterSource,
)
from app.modules.onboarding.domain.entities.qualification_enums import QualificationState
from app.modules.onboarding.domain.entities.saved_list import SavedListObject
from app.modules.onboarding.infrastructure.repositories.exporter_profile_repository import (
    CompanySort,
)

ColumnId = Annotated[str, StringConstraints(pattern=r"^[a-z_]{1,40}$")]


class DealListFilters(BaseModel):
    """`GET /onboarding/deals`'s filters."""

    model_config = ConfigDict(extra="forbid")

    stages: list[DealStage] = Field(default_factory=list, max_length=4)
    q: str | None = Field(default=None, max_length=200)
    opened_from: date | None = None
    opened_to: date | None = None

    @model_validator(mode="after")
    def _range(self) -> Self:
        if self.opened_from and self.opened_to and self.opened_from > self.opened_to:
            raise ValueError("`opened_from` must not be after `opened_to`")
        return self


class CompanyListFilters(BaseModel):
    """`GET /onboarding/exporters`'s list filters — never an identifier search."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=200)
    journey: ExporterJourney | None = None
    qualification: QualificationState | None = None
    marker: ExporterMarker | None = None
    source: ExporterSource | None = None
    added_from: date | None = None
    added_to: date | None = None

    @model_validator(mode="after")
    def _range(self) -> Self:
        if self.added_from and self.added_to and self.added_from > self.added_to:
            raise ValueError("`added_from` must not be after `added_to`")
        return self


_FILTERS = {SavedListObject.DEALS: DealListFilters, SavedListObject.COMPANIES: CompanyListFilters}
_SORTS = {SavedListObject.DEALS: DealQueueSort, SavedListObject.COMPANIES: CompanySort}


class SavedListRequest(BaseModel):
    """Create or change a saved list. `filters` are checked against `object_type`."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    object_type: SavedListObject
    filters: dict[str, Any] = Field(
        default_factory=dict, json_schema_extra={"additionalProperties": True}
    )
    columns: list[ColumnId] = Field(default_factory=list, max_length=30)
    sort: str | None = Field(default=None, max_length=40)
    sort_order: Literal["asc", "desc"] | None = None

    @model_validator(mode="after")
    def _matches_object_type(self) -> Self:
        # Normalised through the object type's own model: unknown keys are refused,
        # values are coerced, and what is stored is exactly what the endpoint takes.
        self.filters = _FILTERS[self.object_type].model_validate(self.filters).model_dump(
            mode="json", exclude_none=True, exclude_defaults=True
        )
        if self.sort is not None:
            allowed = {member.value for member in _SORTS[self.object_type]}
            if self.sort not in allowed:
                raise ValueError(f"`sort` must be one of {sorted(allowed)} for {self.object_type.value}")
        self.name = self.name.strip()
        if not self.name:
            raise ValueError("a list needs a name")
        return self


class SavedListResponse(BaseModel):
    id: uuid.UUID
    name: str
    object_type: SavedListObject
    filters: dict[str, Any] = Field(json_schema_extra={"additionalProperties": True})
    columns: list[str]
    sort: str | None
    sort_order: str | None
    created_by: uuid.UUID
    created_by_name: str | None
    created_at: datetime
    updated_at: datetime
    can_edit: bool = Field(description="Whether **this** caller may change or delete it.")


class SavedListsResponse(BaseModel):
    lists: list[SavedListResponse]
    can_create: bool = Field(description="ADMIN or DEVELOPER — who may build a list.")


__all__ = [
    "DealListFilters",
    "CompanyListFilters",
    "SavedListRequest",
    "SavedListResponse",
    "SavedListsResponse",
]
