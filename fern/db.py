"""Open the Conservatory's database and bring its schema up to date.

Fern is the only process that creates or alters tables. The web app opens the
same file with node:sqlite and trusts that this module has run first.

Schema changes after the baseline go in MIGRATIONS as (version, sql) steps.
Each step runs once, in order, inside a transaction, and records its version
in schema_version. The baseline (schema.sql) is version 1. A step that
rebuilds a table carries a third element, FOREIGN_KEYS_OFF (below).
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA_PATH = Path(__file__).with_name("schema.sql")
BASELINE_VERSION = 1

# The step kind for a table rebuild, SQLite's documented procedure (create the
# new table, copy, drop the old, rename). With foreign keys on, DROP TABLE
# first deletes the old table's rows, and the cascades take every child row
# with them, so the step runs with foreign keys off and is checked with
# PRAGMA foreign_key_check before it commits (_apply_rebuild).
FOREIGN_KEYS_OFF = "foreign_keys_off"

# Append only. Never edit a step that has shipped.
MIGRATIONS: list[tuple[int, str] | tuple[int, str, str]] = [
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
    # v5 (#36): a printed pot tag opens /t/<specimen id> for years, so an id
    # must never be handed out twice. A plain INTEGER PRIMARY KEY reuses the
    # highest id once its row is deleted; AUTOINCREMENT never does. Copying
    # the rows with their ids seeds sqlite_sequence with the highest, so
    # nothing at or below it is used again. tagged_at is when the plant's tag
    # was last printed and marked as tagged.
    (
        5,
        """
        CREATE TABLE specimens_new (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          species_id  INTEGER NOT NULL REFERENCES species(id),
          nickname    TEXT,
          location    TEXT,
          acquired_on TEXT,
          status      TEXT    NOT NULL DEFAULT 'alive'
                              CHECK (status IN ('alive', 'gifted', 'died')),
          created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          tagged_at   TEXT                                 -- when its pot tag was last printed and marked, else NULL
        );
        INSERT INTO specimens_new (id, species_id, nickname, location, acquired_on, status, created_at)
          SELECT id, species_id, nickname, location, acquired_on, status, created_at FROM specimens;
        DROP TABLE specimens;
        ALTER TABLE specimens_new RENAME TO specimens;
        CREATE INDEX specimens_location ON specimens (location);
        CREATE INDEX specimens_species ON specimens (species_id);
        """,
        FOREIGN_KEYS_OFF,
    ),
    # v6 (#46): the photo a plant is known by, chosen on its page. NULL means
    # its newest, as before, so no plant changes on deploy; the web app orders
    # a plant's photos main first, then newest. It goes with the photo, so a
    # removed photo leaves the plant on its newest again. A later rebuild of
    # specimens must carry this column.
    (
        6,
        """
        ALTER TABLE specimens ADD COLUMN hero_photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL;
        """,
    ),
    # v7 (#47): a plant is known by its species (its common name, else its
    # binomial), so the nickname goes. The column is in no index, view or
    # trigger, so SQLite's DROP COLUMN (3.35+) does it in place; no rebuild.
    (
        7,
        """
        ALTER TABLE specimens DROP COLUMN nickname;
        """,
    ),
    # v8 (#62): the confirm route now writes the tapped candidate's first
    # common name onto a new species; before, it dropped it, and a species
    # GBIF has no English name for never got one. Data only: fill each
    # species with no common name, once, from the candidates of the jobs that
    # named it (the candidate with the species' name, species rows before
    # genus, earliest confirmation first). Enrichment fills only empty names,
    # so nothing it wrote is overwritten.
    (
        8,
        """
        UPDATE species SET common_name = (
          SELECT trim(json_extract(c.common_names, '$[0]'))
            FROM confirmations f
            JOIN specimens sp ON sp.id = f.specimen_id
            JOIN candidates c ON c.job_id = f.job_id AND lower(c.scientific_name) = lower(species.scientific_name)
           WHERE sp.species_id = species.id
             AND json_valid(c.common_names)
             AND json_type(c.common_names, '$[0]') = 'text'
             AND trim(json_extract(c.common_names, '$[0]')) <> ''
           ORDER BY c.kind = 'species' DESC, f.confirmed_at, f.job_id, c.rank
           LIMIT 1
        )
        WHERE common_name IS NULL;
        """,
    ),
    # v9 (#77): the photo a species is known by, chosen on its page, as v6's
    # is for a plant. NULL means the newest of its plants' main photos, as
    # before, so no species changes on deploy. It goes with the photo. The web
    # app counts it only while the photo is on a plant of that species.
    (
        9,
        """
        ALTER TABLE species ADD COLUMN hero_photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL;
        """,
    ),
    # v10 (#87): a plant's health checks. The web app inserts a row in state
    # queued when the owner presses "Check health"; Fern takes the oldest one
    # per idle tick, asks a vision model once, and writes the result or the
    # reason it failed on the same row (fern/health.py). Checks are kept, so
    # the page shows the latest and the history. They go with their plant.
    # photo_ids keeps the ids as they were sent: a photo removed later leaves
    # the check, and the page shows the thumbs that still exist.
    (
        10,
        """
        CREATE TABLE health_checks (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          specimen_id    INTEGER NOT NULL REFERENCES specimens(id) ON DELETE CASCADE,
          state          TEXT    NOT NULL DEFAULT 'queued'
                                 CHECK (state IN ('queued', 'running', 'done', 'failed')),
          photo_ids      TEXT    NOT NULL,   -- JSON array of photos.id, one to three, in the order sent
          question       TEXT,               -- what the owner asked, else NULL
          status         TEXT,               -- healthy | watch | needs_attention | cannot_tell, once done
          summary        TEXT,               -- the one-sentence reading, once done
          answer         TEXT,               -- JSON: the validated answer, once done
          model          TEXT,               -- the gateway model slug that was asked
          prompt_version INTEGER,            -- fern/prompts/health_check.md's version
          input_tokens   INTEGER,
          output_tokens  INTEGER,
          error          TEXT,               -- why it failed, else NULL
          created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          finished_at    TEXT
        );
        CREATE INDEX health_checks_specimen ON health_checks (specimen_id, id);
        CREATE INDEX health_checks_state ON health_checks (state, id);
        """,
    ),
    # v11 (#99): two things the owner may say about the plant when starting a
    # check, both optional and NULL when left blank: whether it grows indoors
    # or outdoors, and whether its light is natural or artificial. They are on
    # the check, not the plant: they are what the owner said for this reading.
    (
        11,
        """
        ALTER TABLE health_checks ADD COLUMN setting TEXT CHECK (setting IN ('indoors', 'outdoors'));
        ALTER TABLE health_checks ADD COLUMN light TEXT CHECK (light IN ('natural', 'artificial'));
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
    for step_version, sql, *kind in MIGRATIONS:
        if step_version <= version:
            continue
        if kind == [FOREIGN_KEYS_OFF]:
            _apply_rebuild(conn, step_version, sql)
        else:
            with conn:
                conn.executescript(sql)
                conn.execute("INSERT INTO schema_version (version) VALUES (?)", (step_version,))
        version = step_version
    return version


def _apply_rebuild(conn: sqlite3.Connection, step_version: int, sql: str) -> None:
    """Run a table-rebuild step with foreign keys off, all or nothing.

    PRAGMA foreign_keys is a no-op inside a transaction, so it is switched
    outside one. The step and its version row commit together only when
    PRAGMA foreign_key_check finds nothing; any broken link rolls it back.
    """
    conn.commit()
    conn.execute("PRAGMA foreign_keys=OFF")
    try:
        conn.executescript("BEGIN;\n" + sql)
        broken = conn.execute("PRAGMA foreign_key_check").fetchall()
        if broken:
            first = broken[0]
            raise sqlite3.IntegrityError(
                f"v{step_version}: foreign_key_check found {len(broken)} broken link(s), "
                f"first {first[0]} row {first[1]} -> {first[2]}"
            )
        conn.execute("INSERT INTO schema_version (version) VALUES (?)", (step_version,))
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.execute("PRAGMA foreign_keys=ON")


def queued_jobs(conn: sqlite3.Connection) -> int:
    return int(conn.execute("SELECT COUNT(*) FROM jobs WHERE status = 'queued'").fetchone()[0])
