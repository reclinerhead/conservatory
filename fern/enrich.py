"""The enrichment pass: what a species *is*, filled in once per species (#20).

Runs from the worker loop when the identification queue is idle, one species
per tick, oldest unenriched first; a species whose last pass fell short is
tried again after RETRY_AFTER. Two free sources, in order of cost:

1. GBIF's backbone match (api.gbif.org/v1/species/match) for the taxonomy:
   the ranks come back on the match itself, so one call fills kingdom through
   genus, the canonical spelling and the author. A second call fetches the
   first English vernacular name. The cultivar never goes to GBIF: the row's
   scientific_name is matched alone, and a cultivar someone typed into the
   name is stripped first (`match_name`).
2. Wikipedia's Action API (en.wikipedia.org/w/api.php) for the lead
   paragraphs, the article link and the page image, in one query. The REST
   page/summary endpoint the issue sketched is in gradual deprecation (the
   Aviary's species_profile.py litigated this); the Action API is the stable
   path, takes maxlag, and resolves redirects, so a synonym still lands on
   the article. A missing page and a disambiguation page both count as "no
   page": that is not an error, the row is stamped enriched without a summary.

Everything that decides what a response means is pure and tested
(`match_name`, `parse_match`, `parse_vernacular`, `parse_page`, `worklist`);
the wire (`get_json`, `get_bytes`) is two thin functions the tests replace.
The reference image is re-encoded like a photo (1280 px, a 320 px thumbnail
beside it) under CONSERVATORY_DATA/reference/, never under photos/.
"""

from __future__ import annotations

import html
import io
import logging
import re
import sqlite3
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

import requests
from PIL import Image

from . import plantnet
from .queue import iso

log = logging.getLogger("fern")

USER_AGENT = "Conservatory/0.2 (https://github.com/reclinerhead/conservatory)"
GBIF_MATCH_URL = "https://api.gbif.org/v1/species/match"
GBIF_SPECIES_URL = "https://api.gbif.org/v1/species"
WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
COMMONS_FILE_URL = "https://commons.wikimedia.org/wiki/File:"
FETCH_TIMEOUT_S = 20.0
WIKI_MAXLAG_S = 5

MIN_CONFIDENCE = 80
ACCEPTED_RANKS = ("species", "subspecies", "variety", "form", "genus")
RETRY_AFTER = timedelta(days=1)
REFERENCE_DIR = "reference"
IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png")

JsonFn = Callable[[str, dict], dict]
BytesFn = Callable[[str], bytes]


# ----------------------------------------------------------------------------
# Pure
# ----------------------------------------------------------------------------

_QUOTED = re.compile(r"""\s*['"‘’“”][^'"‘’“”]*['"‘’“”].*$""")
_CV = re.compile(r"\s+(cv\.?|cultivar)\s.*$", re.IGNORECASE)
_SP = re.compile(r"\s+(sp|spp|ssp|cf|aff)\.?$", re.IGNORECASE)
_BLANK_RUNS = re.compile(r"\n{3,}")


def match_name(scientific_name: str) -> str:
    """What goes to GBIF: the name without a cultivar or a placeholder.

    "Ficus elastica 'Ruby'" -> "Ficus elastica"; "Echeveria cv. Black Prince"
    -> "Echeveria"; "Sedum sp." -> "Sedum". The cultivar column is never
    consulted here: it is already separate, this only catches one typed into
    the name itself."""
    name = scientific_name.strip()
    name = _QUOTED.sub("", name)
    name = _CV.sub("", name)
    name = _SP.sub("", name)
    return re.sub(r"\s+", " ", name).strip()


@dataclass
class Taxonomy:
    gbif_key: int
    rank: str  # lowercase: species | genus | subspecies | variety | form
    canonical_name: str
    authorship: str | None
    kingdom: str | None
    phylum: str | None
    class_: str | None
    order: str | None
    family: str | None
    genus: str | None
    confidence: int
    match_type: str


def parse_match(body: dict | None) -> Taxonomy | None:
    """GBIF's match response -> a Taxonomy, or None for a miss.

    A miss is matchType NONE, a confidence under MIN_CONFIDENCE, or a match at
    a rank above genus: GBIF answers a nonsense name with kingdom Plantae at
    confidence 99 (HIGHERRANK), so the rank is the real test. A genus-level
    match (HIGHERRANK at rank GENUS, or an exact genus name) is accepted:
    most of a succulent shelf is a genus with a nursery tag."""
    body = body or {}
    match_type = str(body.get("matchType") or "NONE").upper()
    rank = str(body.get("rank") or "").lower()
    try:
        confidence = int(body.get("confidence") or 0)
    except (TypeError, ValueError):
        confidence = 0
    key = body.get("usageKey")
    canonical = body.get("canonicalName") or ""
    if match_type == "NONE" or rank not in ACCEPTED_RANKS or confidence < MIN_CONFIDENCE or not key or not canonical:
        return None
    full = str(body.get("scientificName") or "")
    authorship = full[len(canonical):].strip() if full.startswith(canonical) else None
    return Taxonomy(
        gbif_key=int(key),
        rank=rank,
        canonical_name=str(canonical),
        authorship=authorship or None,
        kingdom=body.get("kingdom"),
        phylum=body.get("phylum"),
        class_=body.get("class"),
        order=body.get("order"),
        family=body.get("family"),
        genus=body.get("genus"),
        confidence=confidence,
        match_type=match_type,
    )


def parse_vernacular(body: dict | None) -> str | None:
    """The first English vernacular name in GBIF's list, or None."""
    for row in (body or {}).get("results") or []:
        if not isinstance(row, dict):
            continue
        if str(row.get("language") or "").lower() in ("eng", "en"):
            name = str(row.get("vernacularName") or "").strip()
            if name:
                return name
    return None


@dataclass
class Page:
    title: str
    url: str
    summary: str | None
    image_url: str | None
    image_name: str | None
    image_width: int | None = None
    image_height: int | None = None

    @property
    def credit(self) -> str:
        return f"{self.title} · Wikipedia"

    @property
    def image_source_url(self) -> str | None:
        return COMMONS_FILE_URL + quote(self.image_name.replace(" ", "_")) if self.image_name else None


def clean_extract(text: str | None) -> str | None:
    """An exintro extract -> the lead paragraphs: entities unescaped, blank runs collapsed."""
    if not text:
        return None
    text = _BLANK_RUNS.sub("\n\n", html.unescape(text)).strip()
    return text or None


def is_disambiguation(body: dict | None) -> bool:
    """Whether the query landed on a disambiguation page: "Iris" lists an eye
    part, a colour and a goddess before the plant. The caller then asks for
    "Iris (plant)", Wikipedia's convention for the botanical article."""
    pages = ((body or {}).get("query") or {}).get("pages") or []
    page = pages[0] if pages and isinstance(pages[0], dict) else None
    return bool(page) and "disambiguation" in (page.get("pageprops") or {})


def parse_page(body: dict | None) -> Page | None:
    """The Wikipedia query -> a Page, or None when there is no article.

    A page marked `missing` is the 404 case; a disambiguation page counts as
    none too (`is_disambiguation` tells them apart). The page image is kept
    only when it is a raster (a range map arrives as SVG on some articles)."""
    pages = ((body or {}).get("query") or {}).get("pages") or []
    page = pages[0] if pages and isinstance(pages[0], dict) else None
    if not page or page.get("missing") or is_disambiguation(body):
        return None
    title = str(page.get("title") or "").strip()
    url = str(page.get("canonicalurl") or page.get("fullurl") or "")
    if not title or not url:
        return None
    original = page.get("original") or {}
    name = page.get("pageimage")
    image_url = original.get("source") if isinstance(original, dict) else None
    if not (name and image_url and str(name).lower().endswith(IMAGE_EXTENSIONS)):
        name, image_url, original = None, None, {}
    return Page(
        title=title,
        url=url,
        summary=clean_extract(page.get("extract")),
        image_url=image_url,
        image_name=str(name) if name else None,
        image_width=original.get("width") if original else None,
        image_height=original.get("height") if original else None,
    )


def image_path(species_id: int) -> str:
    return f"{REFERENCE_DIR}/{species_id}.jpg"


def worklist(conn: sqlite3.Connection, now: datetime, limit: int = 1) -> list[sqlite3.Row]:
    """Species that want a pass: never enriched first (oldest first), then
    those whose last pass fell short and is older than RETRY_AFTER. A row
    enriched without error is never here again; `--enrich` is the way back."""
    cutoff = iso(now - RETRY_AFTER)
    return conn.execute(
        """
        SELECT id, scientific_name, cultivar, common_name FROM species
         WHERE enriched_at IS NULL
            OR (enrich_error IS NOT NULL AND enriched_at <= ?)
         ORDER BY enriched_at IS NOT NULL, created_at, id
         LIMIT ?
        """,
        (cutoff, limit),
    ).fetchall()


# ----------------------------------------------------------------------------
# I/O
# ----------------------------------------------------------------------------


def get_json(url: str, params: dict) -> dict:
    """One GET, identified, one patient retry on 503 (Wikipedia's maxlag answer)."""
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    for attempt in (1, 2):
        resp = requests.get(url, params=params, headers=headers, timeout=FETCH_TIMEOUT_S)
        if resp.status_code == 503 and attempt == 1:
            time.sleep(3)
            continue
        resp.raise_for_status()
        body = resp.json()
        return body if isinstance(body, dict) else {}
    return {}


def get_bytes(url: str) -> bytes:
    resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=FETCH_TIMEOUT_S * 3)
    resp.raise_for_status()
    return resp.content


def write_reference_image(raw: bytes, data_dir: Path, species_id: int) -> tuple[str, int, int]:
    """Re-encode the download like a photo: 1280 px JPEG at reference/<id>.jpg
    with a 320 px .thumb.jpg beside it. Returns (relative path, width, height)."""
    rel = image_path(species_id)
    dst = data_dir / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(plantnet.prepare_image(io.BytesIO(raw)))  # type: ignore[arg-type]  (Image.open takes a file object)
    plantnet.write_thumbnail(dst, dst.with_name(f"{species_id}.thumb.jpg"))
    with Image.open(dst) as im:
        w, h = im.size
    return rel, w, h


# ----------------------------------------------------------------------------
# The per-species function (what --enrich calls, and what the loop calls)
# ----------------------------------------------------------------------------


def enrich_species(
    conn: sqlite3.Connection,
    data_dir: Path,
    species_id: int,
    now: datetime | None = None,
    fetch_json: JsonFn = get_json,
    fetch_bytes: BytesFn = get_bytes,
) -> str:
    """Fill one species row from GBIF and Wikipedia. Returns the journal line.

    Raises on a transport failure (the caller stamps the error); a source
    that has nothing is not a failure, it is recorded in the line and, for a
    GBIF miss, in enrich_error so a day later the row gets another look."""
    now = now or datetime.now(timezone.utc)
    row = conn.execute("SELECT * FROM species WHERE id = ?", (species_id,)).fetchone()
    if row is None:
        raise LookupError(f"no species {species_id}")
    name = match_name(row["scientific_name"])
    parts: list[str] = []
    errors: list[str] = []
    cols: dict[str, object] = {}

    # 1. GBIF
    tax = parse_match(fetch_json(GBIF_MATCH_URL, {"name": name, "kingdom": "Plantae", "strict": "false"}))
    if tax:
        cols.update(
            gbif_key=tax.gbif_key,
            rank=tax.rank,
            kingdom=tax.kingdom,
            phylum=tax.phylum,
            **{"class": tax.class_},
            order_=tax.order,
            family=tax.family,
            genus=tax.genus,
            canonical_name=tax.canonical_name,
            authorship=tax.authorship,
        )
        if not row["common_name"]:
            common = parse_vernacular(fetch_json(f"{GBIF_SPECIES_URL}/{tax.gbif_key}/vernacularNames", {"limit": 100}))
            if common:
                cols["common_name"] = common
        parts.append(f"GBIF {tax.gbif_key} ({tax.family or tax.rank})")
    else:
        errors.append(f"GBIF: no match for {name!r}")
        parts.append("GBIF no match")

    # 2. Wikipedia, by GBIF's spelling when it has one, else by the name as
    # typed. A genus that shares its name with something more famous lands on
    # a disambiguation page; "<name> (plant)" is where the article lives then.
    title = tax.canonical_name if tax else name
    body = fetch_json(WIKIPEDIA_API, _wiki_params(title))
    if is_disambiguation(body):
        body = fetch_json(WIKIPEDIA_API, _wiki_params(f"{title} (plant)"))
    page = parse_page(body)
    if page:
        cols.update(summary=page.summary, summary_url=page.url)
        parts.append(f"Wikipedia summary {len(page.summary)} chars" if page.summary else "Wikipedia page without a lead")
        if page.image_url:
            rel, w, h = write_reference_image(fetch_bytes(page.image_url), data_dir, species_id)
            cols.update(image_path=rel, image_credit=page.credit, image_source_url=page.image_source_url)
            parts.append(f"image {w}x{h}")
        else:
            parts.append("no image")
    else:
        parts.append("Wikipedia no page")

    cols["enriched_at"] = iso(now)
    cols["enrich_error"] = "; ".join(errors) if errors else None
    _update(conn, species_id, cols)
    return f"enriched {row['scientific_name']}: " + ", ".join(parts)


def _wiki_params(title: str) -> dict:
    return {
        "action": "query",
        "format": "json",
        "formatversion": 2,
        "redirects": 1,
        "maxlag": WIKI_MAXLAG_S,
        "prop": "extracts|pageimages|info|pageprops",
        "exintro": 1,
        "explaintext": 1,
        "piprop": "original|name",
        "inprop": "url",
        "ppprop": "disambiguation",
        "titles": title,
    }


def _update(conn: sqlite3.Connection, species_id: int, cols: dict[str, object]) -> None:
    assignments = ", ".join(f'"{k}" = ?' for k in cols)
    with conn:
        conn.execute(f"UPDATE species SET {assignments} WHERE id = ?", (*cols.values(), species_id))


def run_once(
    conn: sqlite3.Connection,
    data_dir: Path,
    now: datetime | None = None,
    fetch_json: JsonFn = get_json,
    fetch_bytes: BytesFn = get_bytes,
) -> bool:
    """One species off the worklist, if any. Returns whether there was one.

    A failure is one loud line and a stamped row, never an exception out of
    the loop and never an immediate retry: the stamp keeps the row off the
    worklist until RETRY_AFTER has passed."""
    now = now or datetime.now(timezone.utc)
    rows = worklist(conn, now)
    if not rows:
        return False
    row = rows[0]
    try:
        log.info("%s", enrich_species(conn, data_dir, row["id"], now, fetch_json, fetch_bytes))
    except Exception as exc:  # noqa: BLE001  (one loud line per failure, whatever it was)
        log.error("enrich %s (species %d) FAILED: %s", row["scientific_name"], row["id"], f"{type(exc).__name__}: {exc}"[:300])
        _update(conn, row["id"], {"enriched_at": iso(now), "enrich_error": f"{type(exc).__name__}: {exc}"[:300]})
    return True
