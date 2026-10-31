-- The Conservatory's schema, owned by Fern (fern/db.py applies it on start).
--
-- This file is the baseline and must stay idempotent: every statement is
-- CREATE ... IF NOT EXISTS. Changes to an existing table are NOT edited in
-- here; they are appended as numbered steps to MIGRATIONS in fern/db.py, and
-- the baseline is only rewritten to match once a step has shipped everywhere.
-- The web app opens this database with node:sqlite and never creates tables.

CREATE TABLE IF NOT EXISTS schema_version (
  version    INTEGER NOT NULL,
  applied_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- A photo a person uploaded. One photo belongs to one identification job and,
-- once confirmed, to one specimen. The file lives under CONSERVATORY_DATA.
CREATE TABLE IF NOT EXISTS photos (
  id          INTEGER PRIMARY KEY,
  path        TEXT    NOT NULL UNIQUE,            -- relative to CONSERVATORY_DATA
  taken_at    TEXT,                               -- ISO 8601, from EXIF when present
  uploaded_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  organ       TEXT    NOT NULL DEFAULT 'auto'     -- leaf | flower | fruit | bark | auto
                      CHECK (organ IN ('leaf', 'flower', 'fruit', 'bark', 'auto')),
  job_id      INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  specimen_id INTEGER REFERENCES specimens(id) ON DELETE SET NULL
);

-- One identification job per upload (or per group of photos of one plant).
-- Fern drains these oldest first. A rejected job is one Pl@ntNet answered 404
-- for: no candidates, straight to the typed-name path.
CREATE TABLE IF NOT EXISTS jobs (
  id              INTEGER PRIMARY KEY,
  status          TEXT    NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('queued', 'identifying', 'identified', 'rejected', 'failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at     TEXT,
  error           TEXT,
  quota_remaining INTEGER                          -- Pl@ntNet's count after this call
);

CREATE INDEX IF NOT EXISTS jobs_status_created ON jobs (status, created_at);

-- Pl@ntNet's ranked answers for a job, plus the genus and family rollups it
-- returns with detailed=true (rank is per kind).
CREATE TABLE IF NOT EXISTS candidates (
  job_id          INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind            TEXT    NOT NULL DEFAULT 'species'
                          CHECK (kind IN ('species', 'genus', 'family')),
  rank            INTEGER NOT NULL,
  scientific_name TEXT    NOT NULL,
  genus           TEXT,
  family          TEXT,
  score           REAL    NOT NULL,
  gbif_id         TEXT,
  common_names    TEXT    NOT NULL DEFAULT '[]',   -- JSON array of strings
  PRIMARY KEY (job_id, kind, rank)
);

-- A taxon the household has confirmed at least once. scientific_name is the
-- classifier's species, or a genus alone, or whatever the person typed when
-- the classifier had nothing; cultivar is the name on the nursery tag.
--
-- Migration v2 (fern/db.py, #20) adds the enrichment columns the worker fills
-- once per species: the GBIF taxonomy (gbif_key, rank, kingdom .. genus,
-- canonical_name, authorship, common_name), the Wikipedia summary and
-- reference image (summary, summary_url, image_path, image_credit,
-- image_source_url) and the pass's own stamps (enriched_at, enrich_error).
-- They are folded into this baseline only once v2 has shipped everywhere.
CREATE TABLE IF NOT EXISTS species (
  id              INTEGER PRIMARY KEY,
  scientific_name TEXT    NOT NULL,
  genus           TEXT,
  family          TEXT,
  gbif_id         TEXT,
  cultivar        TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (scientific_name, cultivar)
);

-- The plant in the pot. Lineage (parent_specimen_id) and the event log arrive
-- in Phase 3 as migration steps.
CREATE TABLE IF NOT EXISTS specimens (
  id          INTEGER PRIMARY KEY,
  species_id  INTEGER NOT NULL REFERENCES species(id),
  nickname    TEXT,
  location    TEXT,                                -- a shelf, a room, a bed
  acquired_on TEXT,                                -- ISO date
  status      TEXT    NOT NULL DEFAULT 'alive'
                      CHECK (status IN ('alive', 'gifted', 'died')),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS specimens_location ON specimens (location);
CREATE INDEX IF NOT EXISTS specimens_species ON specimens (species_id);

-- What the person tapped: which candidate (by rank) or what they typed. Kept
-- for the roster match and for the running accuracy picture.
CREATE TABLE IF NOT EXISTS confirmations (
  job_id       INTEGER NOT NULL PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  specimen_id  INTEGER NOT NULL REFERENCES specimens(id) ON DELETE CASCADE,
  chosen_rank  INTEGER,                            -- NULL when the name was typed
  typed_name   TEXT,
  confirmed_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
