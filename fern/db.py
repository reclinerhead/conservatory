"""Open the Conservatory's database and bring its schema up to date.

Fern is the only process that creates or alters tables. The web app opens the
same file with node:sqlite and trusts that this module has run first.

Schema changes after the baseline go in MIGRATIONS as (version, sql) steps.
Each step runs once, in order, inside a transaction, and records its version
in schema_version. The baseline (schema.sql) is version 1.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA_PATH = Path(__file__).with_name("schema.sql")
BASELINE_VERSION = 1

# Append only. Never edit a step that has shipped.
MIGRATIONS: list[tuple[int, str]] = [
    # v2 (#20): what the enrichment pass writes on a species row. All nullable,
    # so Phase 1 rows and the confirm route's INSERT are untouched. genus and
    # family already exist in the baseline; the pass overwrites them from GBIF.
    (
        2,
        """
        ALTER TABLE species ADD COLUMN gbif_key INTEGER;        -- GBIF backbone usageKey
        ALTER TABLE species ADD COLUMN rank TEXT;               -- species | genus | subspecies | variety | form
        ALTER TABLE species ADD COLUMN kingdom TEXT;
        ALTER TABLE species ADD COLUMN phylum TEXT;
        ALTER TABLE species ADD COLUMN class TEXT;
        ALTER TABLE species ADD COLUMN order_ TEXT;             -- ORDER is a keyword
        ALTER TABLE species ADD COLUMN canonical_name TEXT;     -- GBIF's spelling, no author
        ALTER TABLE species ADD COLUMN authorship TEXT;         -- e.g. Roxb.
        ALTER TABLE species ADD COLUMN common_name TEXT;        -- GBIF's first English vernacular
        ALTER TABLE species ADD COLUMN summary TEXT;            -- Wikipedia lead, plain text
        ALTER TABLE species ADD COLUMN summary_url TEXT;        -- the article
        ALTER TABLE species ADD COLUMN image_path TEXT;         -- reference/<id>.jpg, relative to CONSERVATORY_DATA
        ALTER TABLE species ADD COLUMN image_credit TEXT;       -- "<page title> · Wikipedia"
        ALTER TABLE species ADD COLUMN image_source_url TEXT;   -- the Commons file page
        ALTER TABLE species ADD COLUMN enriched_at TEXT;        -- last pass, success or failure
        ALTER TABLE species ADD COLUMN enrich_error TEXT;       -- why the last pass fell short, else NULL
        """,
    ),
    # v3 (#23): the care sheet, one per species, written once by a language
    # model from the taxonomy and the household's zone (fern/care.py). It goes
    # with its species: the web app deletes a species row when its last
    # specimen goes, and foreign keys are on in both writers.
    (
        3,
        """
        CREATE TABLE care_sheets (
          species_id     INTEGER PRIMARY KEY REFERENCES species(id) ON DELETE CASCADE,
          zone           TEXT,               -- the USDA zone it was written for, e.g. 6a; NULL when none was set
          model          TEXT,               -- the gateway model slug that wrote it
          prompt_version INTEGER NOT NULL,   -- fern/prompts/care_sheet.md's version
          cells          TEXT,               -- JSON: the six cells; NULL until a write has succeeded
          notes          TEXT,               -- JSON: what the prompt carried (subject, level, ranks, zone, summary)
          written_at     TEXT,               -- when the cells were written
          tried_at       TEXT NOT NULL,      -- the last attempt, success or failure
          error          TEXT                -- why the last attempt failed, else NULL
        );
        """,
    ),
    # v4 (#26): a photo added straight to a plant from its page has no job, so
    # run_once never writes its thumbnail. The idle sweep (worker.sweep_once)
    # does, and stamps this column; job photos never read it.
    (
        4,
        """
        ALTER TABLE photos ADD COLUMN thumb_at TEXT;  -- when the sweep wrote a job-less photo's thumbnail, else NULL
        """,
    ),
]

LATEST_VERSION = MIGRATIONS[-1][0] if MIGRATIONS else BASELINE_VERSION


def connect(path: str | Path) -> sqlite3.Connection:
    """Open (creating if needed) the database in WAL mode with the schema applied."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=FULL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")  # the web app writes to this file too
    apply_schema(conn)
    return conn


def current_version(conn: sqlite3.Connection) -> int:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
    ).fetchone()
    if row is None:
        return 0
    v = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0]
    return int(v or 0)


def apply_schema(conn: sqlite3.Connection) -> int:
    """Apply the baseline (idempotent) and any unapplied migration steps. Returns the version."""
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    version = current_version(conn)
    if version < BASELINE_VERSION:
        conn.execute("INSERT INTO schema_version (version) VALUES (?)", (BASELINE_VERSION,))
        conn.commit()
        version = BASELINE_VERSION
    for step_version, sql in MIGRATIONS:
        if step_version <= version:
            continue
        with conn:
            conn.executescript(sql)
            conn.execute("INSERT INTO schema_version (version) VALUES (?)", (step_version,))
        version = step_version
    return version


def queued_jobs(conn: sqlite3.Connection) -> int:
    return int(conn.execute("SELECT COUNT(*) FROM jobs WHERE status = 'queued'").fetchone()[0])
