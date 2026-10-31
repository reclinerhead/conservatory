# Fern

Fern is the Conservatory's worker: a Python 3.13 package in `fern/`, run as `python -m fern`. It owns the database, drains the identification queue, is the only process that calls Pl@ntNet, and fills in what each species is from GBIF and Wikipedia when the queue is idle. It is named in the tradition of the Aviary's Earl and Willard.

## Running it

```powershell
.venv\Scripts\pip install -r fern\requirements.txt
.venv\Scripts\python -m fern
```

Environment: `CONSERVATORY_DB` (default `data/conservatory.db`), `CONSERVATORY_DATA` (default `data/`; photos under `photos/`, reference images under `reference/`), and `PLANTNET_API_KEY`, without which Fern refuses to start. On start it opens the database, applies the schema, logs the queue depth, and drains the queue until stopped (SIGTERM or Ctrl-C); whenever the queue is idle it gives the tick to the enrichment pass instead (below). `python -m fern --enrich <species id>` runs that pass for one species by hand, prints its journal line, and exits; it needs no Pl@ntNet key.

## The database

`fern/db.py` is the one place that opens the file for writing from Python. `connect(path)` creates parent directories, opens SQLite with `journal_mode=WAL`, `synchronous=FULL`, `foreign_keys=ON`, and a 5 s `busy_timeout` (the web app writes to the same file), then applies the schema.

**Schema ownership.** `fern/schema.sql` is the baseline, version 1, and is idempotent: every statement is `CREATE ... IF NOT EXISTS`, so applying it to a live database is a no-op. Changes to an existing table are never edited into the baseline. They are appended to `MIGRATIONS` in `db.py` as `(version, sql)` steps; each runs once, in order, inside a transaction, and records its version in `schema_version`. The baseline may be rewritten to match only once a step has shipped to every box. `db.LATEST_VERSION` is the version a fresh database comes up at: **2** today (v2 is the enrichment columns on `species`, below). The web app never creates or alters tables; it trusts that Fern ran first, and `web/lib/db.ts` returns empty counts when the file does not exist yet.

**Tables.** All timestamps are ISO 8601 text in UTC.

| Table | Holds | Notes |
| --- | --- | --- |
| `photos` | one uploaded photo | `path` relative to `CONSERVATORY_DATA`; `organ` is the Pl@ntNet hint (`leaf`, `flower`, `fruit`, `bark`, `auto`); linked to a job and, once confirmed, a specimen |
| `jobs` | one identification request | `status`: `queued` → `identifying` → `identified` or `rejected` (Pl@ntNet 404, no candidates) or `failed` (retry after `next_attempt_at`); `quota_remaining` is Pl@ntNet's count after the call |
| `candidates` | Pl@ntNet's ranked answers for a job | `kind` is `species`, `genus`, or `family` (the rollups from `detailed=true`); `common_names` is a JSON array |
| `species` | a taxon the household has confirmed | `scientific_name` may be a species, a genus alone, or whatever the person typed; `cultivar` is the nursery-tag name; unique on the pair. v2 adds the columns the enrichment pass fills (listed under Enrichment); all nullable, so the confirm route's insert is unchanged |
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

`run_once` claims a job, prepares its photos, calls identify, records the outcome, writes thumbnails, and logs one line: `job 7: identified Ficus elastica 0.80 (quota left 487)`. `run_forever` repeats it: one second between jobs, a pause until the reset time after a quota outcome, and when the queue is idle one call to `enrich.run_once` (one species, then a second of sleep; two when there was nothing to enrich either). The queue always wins the tick: an upload never waits behind Wikipedia. The clock and the identify function are parameters so the tests run without the network.

## Enrichment (`fern/enrich.py`)

Once per species, the worker fills in what the species *is*: its taxonomy from GBIF, its summary and reference image from Wikipedia. The web app reads these and never calls either source. The pass is worklist-driven and idempotent: `worklist(conn, now)` picks species with no `enriched_at` (oldest first), then those whose last pass left an `enrich_error` and is older than `RETRY_AFTER` (a day). A species enriched without error is never picked again; `--enrich <id>` is the way to redo one. So on the first deploy every existing species is on the list and gets its pass within the first minute, and a species confirmed later is enriched on the next idle tick.

**One species, three steps** (`enrich_species`):

1. **GBIF match.** `GET api.gbif.org/v1/species/match?name=<name>&kingdom=Plantae`, where `<name>` is `match_name(scientific_name)`: the row's name with any cultivar someone typed into it stripped (`Ficus elastica 'Ruby'` → `Ficus elastica`; the `cultivar` column never goes anywhere). `parse_match` accepts a match at rank species (or subspecies, variety, form) or genus with `confidence` ≥ 80 and a `matchType` other than NONE. The rank is the real test, not the confidence: GBIF answers a nonsense name with kingdom Plantae at confidence 99 (`HIGHERRANK`). A genus-level match is accepted on purpose, because most of a succulent shelf is a genus with a nursery tag. The ranks come back on the match itself and overwrite `genus` and `family` (Pl@ntNet's copies) along with the new columns; `scientific_name` is never rewritten, it is the confirmed name and half of the unique key. A second call, `/v1/species/<key>/vernacularNames`, supplies `common_name` (the first English entry) when the row has none. A miss is recorded in `enrich_error` (`GBIF: no match for 'Blorbus nonsensicus'`) and the pass carries on to Wikipedia with the name as typed.
2. **Wikipedia.** One query to the Action API (`en.wikipedia.org/w/api.php`: `prop=extracts|pageimages|info|pageprops`, `exintro`, `explaintext`, `piprop=original|name`, `redirects=1`, `maxlag=5`) by GBIF's canonical name, so a genus row looks up the genus article and a synonym follows the redirect. `parse_page` gives the lead paragraphs (`summary`), the article URL (`summary_url`), and the page image. A page marked `missing` is the 404 case and not an error: the row is stamped enriched with no summary. A disambiguation page (`Iris` is an eye part, a colour and a goddess before it is a plant) is retried once as `<name> (plant)`, Wikipedia's convention for the botanical article. The REST `page/summary` endpoint was deliberately not used: it is in gradual deprecation (the Aviary's `species_profile.py` litigated this in 2026), while the Action API is the long-stable path and takes `maxlag`, which a non-interactive job is supposed to send.
3. **The reference image.** The page image's original is downloaded only when it is a raster (`.jpg`, `.jpeg`, `.png`; range maps arrive as SVG), re-encoded exactly like a photo with `plantnet.prepare_image` (1280 px JPEG) to `reference/<species id>.jpg` under `CONSERVATORY_DATA`, with a 320 px `<id>.thumb.jpg` beside it from `plantnet.write_thumbnail`. `image_credit` is `"<page title> · Wikipedia"`, `image_source_url` the Commons file page, where the licence lives. Nothing under `photos/` is read or written, and the web app shows the owner's photos ahead of this image everywhere.

Every pass stamps `enriched_at`; `enrich_error` is NULL when both sources answered, else what fell short. A transport failure (DNS, a 5xx, a timeout) is caught in `run_once`, logged as one loud line (`enrich Ficus elastica (species 1) FAILED: ConnectionError: ...`), and stamped the same way, so the row waits out `RETRY_AFTER` rather than being retried on the next tick. A success logs one line: `enriched Ficus elastica: GBIF 7835333 (Moraceae), Wikipedia summary 405 chars, image 1280x960`.

**The columns (v2 on `species`).**

| Column | From | Holds |
| --- | --- | --- |
| `gbif_key`, `rank`, `canonical_name`, `authorship` | GBIF match | the backbone usage key; `species`, `genus`, `subspecies`, `variety` or `form`; GBIF's spelling; the author string (`Roxb.`) |
| `kingdom`, `phylum`, `class`, `order_`, `family`, `genus` | GBIF match | the ranks (`order_` because ORDER is a keyword) |
| `common_name` | GBIF vernacular names | the first English name |
| `summary`, `summary_url` | Wikipedia | the lead paragraphs, plain text; the article |
| `image_path`, `image_credit`, `image_source_url` | Wikipedia / Commons | `reference/<id>.jpg` relative to `CONSERVATORY_DATA`; the credit line; the Commons file page |
| `enriched_at`, `enrich_error` | the pass | when it last ran; why it fell short, else NULL |

The existing `gbif_id` (text, copied from the Pl@ntNet candidate at confirm time) is left as it was; `gbif_key` is the match's own key and the two can differ for the same plant, because Pl@ntNet's ids are not always backbone keys.

The wire is two functions (`get_json`, identified by a `User-Agent` naming this repo, with one patient retry on a 503 because that is how `maxlag` answers; `get_bytes` for the image) and both are parameters of `enrich_species` and `run_once`, so the tests replace them.

Tests: `test_fern_enrich.py` covers `match_name`, the GBIF match parser (species, genus, the kingdom and NONE misses, the confidence line), the vernacular picker, the page parser (summary and image, no image, SVG skipped, missing, disambiguation), the v2 migration over a Phase 1 database with its rows intact, the worklist order and the retry window, one species end to end with the wire faked (the row, the files, the journal line, and that `photos/` is untouched), the GBIF-miss and genus-page cases, the disambiguation retry, and that a failing fetch is one loud line and no loop. HTTP and the download itself stay untested.
