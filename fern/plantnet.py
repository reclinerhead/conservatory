"""The Pl@ntNet client: one identify call, and the pure functions around it.

Fern is the only process that calls Pl@ntNet, so the daily quota has one
owner. The network call is `identify`; everything that decides what a
response means (`parse_candidates`, `classify`) is pure and tested.

API contract (my.plantnet.org/doc/api/identify): POST multipart to
/v2/identify/{project}?api-key=..., `images` repeated (max 5, one plant),
`organs` repeated in the same order. 200 carries `results` sorted by score;
404 "Species not found" means the image was rejected as not a plant (or no
species at all); 429 means the day's quota is spent, with Retry-After as an
RFC 7231 date.
"""

from __future__ import annotations

import io
import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

import requests
from PIL import Image, ImageOps

try:  # iPhone photos arrive as HEIC when a browser could not re-encode them
    from pillow_heif import register_heif_opener

    register_heif_opener()
except ImportError:  # pragma: no cover
    pass

API_URL = "https://my-api.plantnet.org/v2/identify/all"
ORGANS = ("leaf", "flower", "fruit", "bark", "auto")
MAX_IMAGES = 5
LONG_SIDE = 1280
THUMB_SIDE = 320
NB_RESULTS = 5


@dataclass
class Candidate:
    kind: str  # species | genus | family
    rank: int
    scientific_name: str
    genus: str | None
    family: str | None
    score: float
    gbif_id: str | None = None
    common_names: list[str] = field(default_factory=list)


def _name(d: dict | None) -> str:
    if not d:
        return ""
    return d.get("scientificNameWithoutAuthor") or d.get("scientificName") or ""


def parse_candidates(body: dict) -> list[Candidate]:
    """Species candidates from `results`, plus genus and family rollups.

    The rollups come from `otherResults` when the API sent them (detailed=true)
    and are otherwise computed here by summing species scores per genus and per
    family, which is the same quantity. Either way the confirm screen gets a
    genus row to lead with when the species scores are all low (Phase 0, #1).
    """
    out: list[Candidate] = []
    species: list[Candidate] = []
    for i, r in enumerate(body.get("results") or [], start=1):
        sp = r.get("species") or {}
        species.append(
            Candidate(
                kind="species",
                rank=i,
                scientific_name=_name(sp),
                genus=_name(sp.get("genus")) or None,
                family=_name(sp.get("family")) or None,
                score=float(r.get("score") or 0.0),
                gbif_id=(r.get("gbif") or {}).get("id"),
                common_names=[c for c in (sp.get("commonNames") or []) if isinstance(c, str)][:3],
            )
        )
    out.extend(species)

    other = body.get("otherResults") or {}
    for kind in ("genus", "family"):
        rows = _parse_other(other, kind)
        if not rows:
            rows = _rollup(species, kind)
        out.extend(rows)
    return out


def _parse_other(other: dict, kind: str) -> list[Candidate]:
    items = other.get(kind) or other.get(f"{kind}s") or other.get(f"{kind[:-1]}ies" if kind == "family" else "") or []
    rows: list[Candidate] = []
    for i, item in enumerate(items, start=1):
        if not isinstance(item, dict):
            continue
        name = _name(item.get(kind)) or _name(item)
        if not name:
            continue
        rows.append(
            Candidate(
                kind=kind,
                rank=i,
                scientific_name=name,
                genus=name if kind == "genus" else None,
                family=name if kind == "family" else _name(item.get("family")) or None,
                score=float(item.get("score") or 0.0),
            )
        )
    return rows


def _rollup(species: list[Candidate], kind: str) -> list[Candidate]:
    totals: dict[str, float] = {}
    families: dict[str, str | None] = {}
    for c in species:
        key = c.genus if kind == "genus" else c.family
        if not key:
            continue
        totals[key] = totals.get(key, 0.0) + c.score
        families.setdefault(key, c.family)
    ranked = sorted(totals.items(), key=lambda kv: -kv[1])
    return [
        Candidate(
            kind=kind,
            rank=i,
            scientific_name=name,
            genus=name if kind == "genus" else None,
            family=families[name] if kind == "genus" else name,
            score=round(total, 5),
        )
        for i, (name, total) in enumerate(ranked, start=1)
    ]


@dataclass
class Outcome:
    """What a response means for the job. `status` is one of:
    identified (candidates follow), rejected (not a plant / nothing found),
    quota (day spent; `resume_at` says when), retry (transient), failed (permanent)."""

    status: str
    candidates: list[Candidate] = field(default_factory=list)
    remaining: int | None = None
    resume_at: datetime | None = None
    error: str | None = None


def next_utc_midnight(now: datetime) -> datetime:
    now = now.astimezone(timezone.utc)
    return (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)


def quota_resume(retry_after: str | None, now: datetime) -> datetime:
    """When to try again after a 429: the Retry-After date, else the next UTC midnight."""
    if retry_after:
        try:
            when = parsedate_to_datetime(retry_after)
            if when.tzinfo is None:
                when = when.replace(tzinfo=timezone.utc)
            if when > now:
                return when
        except (TypeError, ValueError):
            pass
    return next_utc_midnight(now)


def classify(status_code: int, body: dict | None, headers: dict | None, now: datetime) -> Outcome:
    headers = {k.lower(): v for k, v in (headers or {}).items()}
    body = body or {}
    if status_code == 200:
        cands = parse_candidates(body)
        remaining = body.get("remainingIdentificationRequests")
        if not any(c.kind == "species" for c in cands):
            return Outcome("rejected", remaining=remaining, error="no species in a 200")
        return Outcome("identified", candidates=cands, remaining=remaining)
    if status_code == 404:
        return Outcome("rejected", error="404 Species not found")
    if status_code == 429:
        return Outcome("quota", resume_at=quota_resume(headers.get("retry-after"), now), error="429 quota exhausted")
    if status_code in (400, 401, 403, 413, 415):
        return Outcome("failed", error=f"http {status_code}: {_short(body)}")
    return Outcome("retry", error=f"http {status_code}: {_short(body)}")


def _short(body: dict) -> str:
    try:
        return json.dumps(body)[:200]
    except (TypeError, ValueError):
        return str(body)[:200]


# ----------------------------------------------------------------------------
# I/O
# ----------------------------------------------------------------------------


def prepare_image(path: Path) -> bytes:
    """Re-encode to JPEG at most 1280 px on the long side, orientation applied.

    The browser already did this for most uploads; this is the HEIC and
    oversize fallback, and it is harmless on a file that is already right."""
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        im.thumbnail((LONG_SIDE, LONG_SIDE))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=90)
        return buf.getvalue()


def write_thumbnail(src: Path, dst: Path) -> None:
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        im.thumbnail((THUMB_SIDE, THUMB_SIDE))
        dst.parent.mkdir(parents=True, exist_ok=True)
        im.save(dst, "JPEG", quality=85)


def identify(api_key: str, images: list[tuple[str, bytes, str]], timeout: float = 60.0) -> tuple[int, dict, dict]:
    """POST the images; returns (status, json body or {}, headers)."""
    files = [("images", (name, data, "image/jpeg")) for name, data, _organ in images[:MAX_IMAGES]]
    data = [("organs", organ if organ in ORGANS else "auto") for _n, _d, organ in images[:MAX_IMAGES]]
    params = {"api-key": api_key, "nb-results": NB_RESULTS, "detailed": "true", "lang": "en"}
    try:
        resp = requests.post(API_URL, params=params, files=files, data=data, timeout=timeout)
    except requests.RequestException as exc:
        return 0, {"error": str(exc)[:200]}, {}
    try:
        body = resp.json()
    except ValueError:
        body = {"raw": resp.text[:200]}
    return resp.status_code, body if isinstance(body, dict) else {"raw": body}, dict(resp.headers)
