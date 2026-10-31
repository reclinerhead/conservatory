# Fern

Fern is the Conservatory's worker: a Python 3.13 package in `fern/`, run as `python -m fern`. It owns the database, drains the identification queue, and is the only process that calls Pl@ntNet. It is named in the tradition of the Aviary's Earl and Willard.

## Running it

```powershell
.venv\Scripts\pip install -r fern\requirements.txt
.venv\Scripts\python -m fern
```

Environment: `CONSERVATORY_DB` (default `data/conservatory.db`), `CONSERVATORY_DATA` (default `data/`), and `PLANTNET_API_KEY`, without which Fern refuses to start. On start it opens the database, applies the schema, logs the queue depth, and drains the queue until stopped (SIGTERM or Ctrl-C).

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

## The queue (`fern/queue.py`)

One job at a time, oldest first. `claim_next` picks the oldest job that is `queued`, or `failed` with its `next_attempt_at` passed and attempts left, and marks it `identifying` in the same transaction. `record_outcome` applies what Pl@ntNet said:

| Outcome | Job becomes | Notes |
| --- | --- | --- |
| `identified` | `identified`, candidates written, `quota_remaining` set | the species rows plus genus and family rollups |
| `rejected` | `rejected` | Pl@ntNet answered 404 (not a plant, or nothing found), or 200 with no species; the confirm screen shows the name field only |
| `quota` | back to `queued`, no attempt counted | the worker pauses until `Retry-After` (an RFC 7231 date) or the next UTC midnight |
| `retry` | `failed` with `next_attempt_at` | network errors and 5xx: 30 s, 60 s, 120 s, 240 s, 480 s, then it stays `failed` with its error after five attempts |
| `failed` | `failed` for good | 400, 401 (a bad key), 403, 413, 415 |

Timestamps are ISO 8601 UTC text in the shape the schema's defaults write, so string comparison orders them. The thumbnail (`<stem>.thumb.jpg`, 320 px) is written for every processed job, rejected ones included, because the confirm screen shows the photo either way.

## The Pl@ntNet client (`fern/plantnet.py`)

`identify` POSTs the job's photos (at most five, re-encoded to 1280 px JPEG by `prepare_image`, which also handles HEIC through pillow-heif) to `/v2/identify/all` with `organs` in the same order, `nb-results=5`, `detailed=true`, rejection on. The key goes in the `api-key` query parameter and comes only from the environment. Everything that decides what a response means is pure:

- `parse_candidates` takes the `results` list in rank order (name, genus, family, score, GBIF id, up to three common names) and adds **genus and family rollups**: from `otherResults` when the API sends them, otherwise computed here by summing species scores per genus and per family. With `detailed=true` the API does send them (confirmed live 2026-10-31: five genus rows and five family rows per job, with their own scores, including genera that appear in no species row, e.g. Sedum 0.79 and Pachyphytum 0.06 beside Sedum pachyphyllum 0.67), so the computed sum is only the fallback. The rollups exist because of Phase 0 (#1): a shelf succulent often comes back as three species of one genus at 0.03 each, and the genus row is what the confirm screen should lead with.
- `classify` maps the HTTP status to an `Outcome` as in the table above.

Tests: `test_fern_plantnet.py` (parser and classifier, with fixtures shaped on the Phase 0 responses) and `test_fern_queue.py` (backoff, claim order, each outcome's effect on the row, and `worker.run_once` with a fake identify function).

## The worker (`fern/worker.py`)

`run_once` claims a job, prepares its photos, calls identify, records the outcome, writes thumbnails, and logs one line: `job 7: identified Ficus elastica 0.80 (quota left 487)`. `run_forever` repeats it: two seconds of sleep when idle, one between jobs, and a pause until the reset time after a quota outcome. The clock and the identify function are parameters so the tests run without the network.
