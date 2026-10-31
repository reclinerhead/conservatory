"""The care pass: how to keep a species alive, written once per species (#23).

The third worklist in Fern's idle hook, after the identification queue and
the enrichment pass. A species GBIF has placed and that has no care sheet
gets one, written by a language model (fern/llm.py) from its taxonomy, the
first sentences of its Wikipedia article and the household's USDA hardiness
zone. One sheet per idle tick, so an upload waits behind at most one model
call. The sheet is stored with what the prompt carried and the figures the
model gave with their basis, so Phase 3's reminders can be derived from it
and the page can show what each figure rests on. The web app reads the
sheet and never calls the model.

A sheet is written again when the prompt's version moves past the one it was
written under, or when the household's zone changes; "Rewrite" on the page
deletes the row, which puts the species back on the list. An answer that
fails the validator, or a call that fails, is one loud line and a row
stamped with the error, tried again after RETRY_AFTER; a sheet that was
already there keeps its cells meanwhile.

Care advice is written for the genus when the species row is a genus (a
nursery tag that names no species) or a hybrid, as the README decided.

Everything that decides something is pure and tested (`load_prompt`,
`parse_zone`, `care_level`, `subject`, `build_prompt`, `parse_answer`,
`worklist`); the model call is a parameter the tests replace.
"""

from __future__ import annotations

import json
import logging
import re
import sqlite3
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import llm
from .queue import iso

log = logging.getLogger("fern")

PROMPT_PATH = Path(__file__).with_name("prompts") / "care_sheet.md"
CELL_KEYS = ("light", "water", "soil", "hardiness", "fertilizing", "dormancy")
RETRY_AFTER = timedelta(days=1)
MAX_HEADLINE = 60
MIN_TEXT = 40
MAX_TEXT = 600
MAX_FIGURES = 4

CompleteFn = Callable[[llm.Config, str, str], llm.Reply]


class InvalidAnswer(ValueError):
    """The model answered, but not with a care sheet this app will store."""


# ----------------------------------------------------------------------------
# Pure
# ----------------------------------------------------------------------------

_FRONT = re.compile(r"\A---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def load_prompt(path: Path = PROMPT_PATH) -> tuple[int, str]:
    """(prompt_version, instructions) from the prompt file's front matter and body."""
    raw = path.read_text(encoding="utf-8")
    m = _FRONT.match(raw)
    if not m:
        raise ValueError(f"{path.name}: no front matter")
    v = re.search(r"^prompt_version:\s*(\d+)\s*$", m.group(1), re.MULTILINE)
    if not v:
        raise ValueError(f"{path.name}: no prompt_version")
    return int(v.group(1)), raw[m.end():].strip()


_ZONE = re.compile(r"^(1[0-3]|[1-9])([ab])?$")


def parse_zone(raw: str | None) -> str | None:
    """A USDA hardiness zone as the environment gives it ("6a", "10B", "zone 7") -> "6a", "10b", "7"; None when unset or not a zone."""
    t = re.sub(r"^(usda\s*)?(zone\s*)?", "", (raw or "").strip().lower())
    return t if _ZONE.match(t) else None


_HYBRID = re.compile(r"(×|\s[xX]\s)")


def care_level(row: sqlite3.Row | dict) -> str:
    """"genus" for a genus-only row or a hybrid, else "species"."""
    if (row["rank"] or "") == "genus":
        return "genus"
    names = f"{row['scientific_name'] or ''} {row['canonical_name'] or ''}"
    return "genus" if _HYBRID.search(names) else "species"


def subject(row: sqlite3.Row | dict, level: str) -> str:
    """The name the sheet is written for: the genus, or GBIF's spelling of the species."""
    if level == "genus":
        return row["genus"] or (row["canonical_name"] or row["scientific_name"]).split()[0]
    return row["canonical_name"] or row["scientific_name"]


def first_sentences(text: str | None, n: int = 2, cap: int = 400) -> str | None:
    """The opening sentences of the Wikipedia lead, enough to anchor the model, never the whole article."""
    t = re.sub(r"\s+", " ", text or "").strip()
    if not t:
        return None
    out = " ".join(re.split(r"(?<=[.!?])\s+", t)[:n])
    return out if len(out) <= cap else out[: cap - 1].rstrip() + "…"


_RANKS = (("kingdom", "kingdom"), ("phylum", "phylum"), ("class", "class"), ("order_", "order"), ("family", "family"), ("genus", "genus"))


def build_prompt(row: sqlite3.Row | dict, zone: str | None) -> tuple[str, dict]:
    """The message that follows the instructions: the facts about this plant, and the same facts as the notes stored with the sheet."""
    level = care_level(row)
    name = subject(row, level)
    taxonomy = {label: row[col] for col, label in _RANKS if row[col]}
    wiki = first_sentences(row["summary"])
    lines = [f"Write the care sheet for: {name}"]
    if level == "genus":
        why = "named only to the genus" if (row["rank"] or "") == "genus" else "a hybrid"
        lines.append(f"Level: genus. The household's plant is {why}, as most nursery plants are, so write for the genus {name} as a whole.")
    else:
        lines.append("Level: species.")
    if row["common_name"]:
        lines.append(f"Common name: {row['common_name']}")
    if row["cultivar"]:
        lines.append(f"Cultivar on the nursery tag: '{row['cultivar']}'")
    if taxonomy:
        lines.append("Taxonomy (GBIF): " + ", ".join(f"{k} {v}" for k, v in taxonomy.items()))
    lines.append(
        f"Household hardiness zone: USDA {zone}"
        if zone
        else "Household hardiness zone: not set. Give the plant's range and say where it can live, without naming a household zone."
    )
    if wiki:
        lines.append(f"Wikipedia: {wiki}")
    notes = {
        "subject": name,
        "level": level,
        "common_name": row["common_name"],
        "cultivar": row["cultivar"],
        "taxonomy": taxonomy,
        "zone": zone,
        "wikipedia": wiki,
        "summary_url": row["summary_url"],
    }
    return "\n".join(lines), notes


def _text(v: object, field: str, cell: str, lo: int, hi: int) -> str:
    if not isinstance(v, str):
        raise InvalidAnswer(f"{cell}: {field} is not text")
    t = re.sub(r"\s+", " ", v).strip()
    if len(t) < lo:
        raise InvalidAnswer(f"{cell}: {field} is too short ({len(t)} characters)")
    if len(t) > hi:
        raise InvalidAnswer(f"{cell}: {field} runs long ({len(t)} characters)")
    return t


def parse_answer(text: str) -> dict:
    """The model's answer -> the six cells, cleaned, or InvalidAnswer.

    Six cells present, each with a short headline, two or three sentences of
    text, and figures that every one carry a label, a value and a basis. A
    stray code fence or a sentence around the object is forgiven; anything
    missing is not. Keys beyond the six are dropped: the sheet is the
    mockup's six cells, no more."""
    s = text.strip()
    start, end = s.find("{"), s.rfind("}")
    if start < 0 or end <= start:
        raise InvalidAnswer("no JSON object in the answer")
    try:
        body = json.loads(s[start : end + 1])
    except json.JSONDecodeError as exc:
        raise InvalidAnswer(f"the answer is not valid JSON ({exc.msg})") from None
    if not isinstance(body, dict):
        raise InvalidAnswer("the answer is not a JSON object")
    missing = [k for k in CELL_KEYS if k not in body]
    if missing:
        raise InvalidAnswer("missing " + ", ".join(missing))
    cells: dict[str, dict] = {}
    for k in CELL_KEYS:
        c = body[k]
        if not isinstance(c, dict):
            raise InvalidAnswer(f"{k}: not an object")
        figures = c.get("figures", [])
        if not isinstance(figures, list) or len(figures) > MAX_FIGURES:
            raise InvalidAnswer(f"{k}: figures must be a list of at most {MAX_FIGURES}")
        clean = []
        for i, f in enumerate(figures, 1):
            if not isinstance(f, dict):
                raise InvalidAnswer(f"{k}: figure {i} is not an object")
            clean.append(
                {
                    "label": _text(f.get("label"), f"figure {i} label", k, 1, 80),
                    "value": _text(f.get("value"), f"figure {i} value", k, 1, 120),
                    "basis": _text(f.get("basis"), f"figure {i} basis", k, 1, 300),
                }
            )
        cells[k] = {
            "headline": _text(c.get("headline"), "headline", k, 1, MAX_HEADLINE),
            "text": _text(c.get("text"), "text", k, MIN_TEXT, MAX_TEXT),
            "figures": clean,
        }
    return cells


def worklist(conn: sqlite3.Connection, now: datetime, prompt_version: int, zone: str | None, limit: int = 1) -> list[sqlite3.Row]:
    """Species that want a sheet. Only a species GBIF has placed (it has a
    gbif_key): without the taxonomy there is nothing to write from. First
    those with no sheet, oldest first; then sheets written under an older
    prompt or for another zone; then failed attempts older than RETRY_AFTER.
    A failed row waits out the day whatever else is true of it, so a broken
    answer is never asked for again on the next tick."""
    cutoff = iso(now - RETRY_AFTER)
    return conn.execute(
        """
        SELECT s.* FROM species s LEFT JOIN care_sheets c ON c.species_id = s.id
         WHERE s.gbif_key IS NOT NULL
           AND (c.species_id IS NULL
                OR (c.error IS NULL AND (c.prompt_version < ? OR c.zone IS NOT ?))
                OR (c.error IS NOT NULL AND c.tried_at <= ?))
         ORDER BY c.species_id IS NOT NULL, s.created_at, s.id
         LIMIT ?
        """,
        (prompt_version, zone, cutoff, limit),
    ).fetchall()


# ----------------------------------------------------------------------------
# The per-species function (what --care calls, and what the loop calls)
# ----------------------------------------------------------------------------


def write_sheet(
    conn: sqlite3.Connection,
    species_id: int,
    cfg: llm.Config,
    zone: str | None,
    now: datetime | None = None,
    complete: CompleteFn = llm.complete,
    prompt_path: Path = PROMPT_PATH,
) -> str:
    """Write one species' sheet. Returns the journal line; raises LlmError or InvalidAnswer, which the caller stamps."""
    now = now or datetime.now(timezone.utc)
    row = conn.execute("SELECT * FROM species WHERE id = ?", (species_id,)).fetchone()
    if row is None:
        raise LookupError(f"no species {species_id}")
    version, system = load_prompt(prompt_path)
    prompt, notes = build_prompt(row, zone)
    reply = complete(cfg, system, prompt)
    cells = parse_answer(reply.text)
    with conn:
        conn.execute(
            """
            INSERT INTO care_sheets (species_id, zone, model, prompt_version, cells, notes, written_at, tried_at, error)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
            ON CONFLICT(species_id) DO UPDATE SET
              zone = excluded.zone, model = excluded.model, prompt_version = excluded.prompt_version,
              cells = excluded.cells, notes = excluded.notes, written_at = excluded.written_at,
              tried_at = excluded.tried_at, error = NULL
            """,
            (species_id, zone, cfg.model, version, json.dumps(cells, ensure_ascii=False), json.dumps(notes, ensure_ascii=False), iso(now), iso(now)),
        )
    figures = sum(len(c["figures"]) for c in cells.values())
    return (
        f"care sheet {row['scientific_name']} (species {species_id}): {notes['level']}-level for {notes['subject']}, "
        f"zone {zone or 'not set'}, {figures} figures, by {cfg.model}, "
        f"{reply.input_tokens if reply.input_tokens is not None else '?'} tokens in, "
        f"{reply.output_tokens if reply.output_tokens is not None else '?'} out"
    )


def stamp_failure(conn: sqlite3.Connection, species_id: int, cfg: llm.Config, zone: str | None, version: int, now: datetime, error: str) -> None:
    """Record a failed attempt. A sheet already there keeps its cells and what they were written under."""
    with conn:
        conn.execute(
            """
            INSERT INTO care_sheets (species_id, zone, model, prompt_version, tried_at, error)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(species_id) DO UPDATE SET tried_at = excluded.tried_at, error = excluded.error
            """,
            (species_id, zone, cfg.model, version, iso(now), error[:300]),
        )


def run_once(
    conn: sqlite3.Connection,
    cfg: llm.Config | None,
    zone: str | None,
    now: datetime | None = None,
    complete: CompleteFn = llm.complete,
    prompt_path: Path = PROMPT_PATH,
) -> bool:
    """One species off the worklist, if a model is configured and there is one. Returns whether a sheet was attempted."""
    if cfg is None:
        return False
    now = now or datetime.now(timezone.utc)
    version, _ = load_prompt(prompt_path)
    rows = worklist(conn, now, version, zone)
    if not rows:
        return False
    row = rows[0]
    try:
        log.info("%s", write_sheet(conn, row["id"], cfg, zone, now, complete, prompt_path))
    except Exception as exc:  # noqa: BLE001  (one loud line per failure, whatever it was)
        error = f"{type(exc).__name__}: {exc}"
        log.error("care sheet %s (species %d) FAILED: %s", row["scientific_name"], row["id"], error[:300])
        stamp_failure(conn, row["id"], cfg, zone, version, now, error)
    return True
