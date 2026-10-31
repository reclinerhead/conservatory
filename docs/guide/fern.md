# Fern

Fern is the Conservatory's worker: a Python 3.13 package in `fern/`, run as `python -m fern`. It owns the database, drains the identification queue, and is the only process that calls Pl@ntNet. It is named in the tradition of the Aviary's Earl and Willard.

## Running it

```powershell
.venv\Scripts\pip install -r fern\requirements.txt
.venv\Scripts\python -m fern
```

Environment: `CONSERVATORY_DB` (default `data/conservatory.db`), `CONSERVATORY_DATA` (default `data/`), and from #6 on, `PLANTNET_API_KEY`. The scaffold's loop opens the database, applies the schema, and logs the queue depth every time it changes; identification arrives with #6.

## The database

`fern/db.py` is the one place that opens the file for writing from Python. `connect(path)` creates parent directories, opens SQLite with `journal_mode=WAL`, `synchronous=FULL`, `foreign_keys=ON`, and a 5 s `busy_timeout` (the web app writes to the same file), then applies the schema.

**Schema ownership.** `fern/schema.sql` is the baseline, version 1, and is idempotent: every statement is `CREATE ... IF NOT EXISTS`, so applying it to a live database is a no-op. Changes to an existing table are never edited into the baseline. They are appended to `MIGRATIONS` in `db.py` as `(version, sql)` steps; each runs once, in order, inside a transaction, and records its version in `schema_version`. The baseline may be rewritten to match only once a step has shipped to every box. The web app never creates or alters tables; it trusts that Fern ran first, and `web/lib/db.ts` returns empty counts when the file does not exist yet.

**Tables (Phase 1).** All timestamps are ISO 8601 text in UTC.

| Table | Holds | Notes |
| --- | --- | --- |
| `photos` | one uploaded photo | `path` relative to `CONSERVATORY_DATA`; `organ` is the Pl@ntNet hint (`leaf`, `flower`, `fruit`, `bark`, `auto`); linked to a job and, once confirmed, a specimen |
| `jobs` | one identification request | `status`: `queued` → `identifying` → `identified` or `rejected` (Pl@ntNet 404, no candidates) or `failed` (retry after `next_attempt_at`); `quota_remaining` is Pl@ntNet's count after the call |
| `candidates` | Pl@ntNet's ranked answers for a job | `kind` is `species`, `genus`, or `family` (the rollups from `detailed=true`); `common_names` is a JSON array |
| `species` | a taxon the household has confirmed | `scientific_name` may be a species, a genus alone, or whatever the person typed; `cultivar` is the nursery-tag name; unique on the pair |
| `specimens` | the plant in the pot | `location` is free text (a shelf, a bed); `status` `alive`, `gifted`, `died`. Lineage and events arrive in Phase 3 as migration steps |
| `confirmations` | what the person tapped for a job | `chosen_rank` or `typed_name`; feeds the roster match and the accuracy picture |

Tests: `test_fern_db.py` at the repo root covers the baseline apply, idempotence, migration ordering, and the status constraint.

## The queue and the Pl@ntNet client

Arrive with #6. The contract they will follow is in epic #4: one job at a time, oldest first; `nb-results=5`, `detailed=true`, rejection on; 404 marks `rejected`, 429 sleeps until `Retry-After`, network errors and 5xx back off exponentially for five attempts.
