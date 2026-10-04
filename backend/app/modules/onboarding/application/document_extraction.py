"""Reading a PO or invoice document into fields — **pluggable, and optional**.

Build prompt chunk 2: which tool reads a PO into structured fields is undecided
(an "Invoice Analyser" was mentioned, AWS Textract floated). So the flow is
upload, then confirm: an extractor may pre-fill the form, or there may be none and
a person types the fields. Either path works today.

An extractor is anything with ``name`` and ``extract(...)``. None is configured
yet, so ``current_extractor()`` returns ``NoExtractor``, which reads nothing. When
a vendor is chosen, it gets an adapter under ``infrastructure/adapters`` and this
function returns it — nothing else changes. Whatever an extractor returns is a
suggestion: nothing is saved until a person confirms it.
"""

from __future__ import annotations

from typing import Literal, Protocol

from app.modules.onboarding.domain.purchase_order_views import ExtractedFields

DocumentKind = Literal["purchase_order", "invoice"]


class DocumentExtractor(Protocol):
    name: str

    async def extract(self, *, storage_key: str, kind: DocumentKind) -> dict[str, str]:
        """Field name → the text read for it. Missing fields are simply absent."""
        ...


class NoExtractor:
    """No vendor chosen yet: reads nothing, so the form starts blank."""

    name = "none"

    async def extract(self, *, storage_key: str, kind: DocumentKind) -> dict[str, str]:
        return {}


def current_extractor() -> DocumentExtractor:
    return NoExtractor()


async def suggest_fields(*, storage_key: str, kind: DocumentKind) -> ExtractedFields:
    extractor = current_extractor()
    if isinstance(extractor, NoExtractor):
        return ExtractedFields(extractor=None)
    return ExtractedFields(
        extractor=extractor.name,
        fields=await extractor.extract(storage_key=storage_key, kind=kind),
    )


__all__ = ["DocumentExtractor", "NoExtractor", "current_extractor", "suggest_fields"]
