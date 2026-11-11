# Fern

Fern is the Conservatory's worker: a Python 3.13 package in `fern/`, run as `python -m fern`. It owns the database, drains the identification queue, is the only process that calls Pl@ntNet or a language model, and when the queue is idle answers a health check someone asked for, fills in what each species is from GBIF and Wikipedia and writes its care sheet. It is named in the tradition of the Aviary's Earl and Willard.

## Running it

```bash
uv venv --python 3.13 .venv
uv pip install --python .venv/bin/python -r fern/requirements.txt
.venv/bin/python -m fern
```

Environment: `CONSERVATORY_DB` (default `data/conservatory.db`), `CONSERVATORY_DATA` (default `data/`; photos under `photos/`, reference images under `reference/`), and `PLANTNET_API_KEY`, without which Fern refuses to start. On start it opens the database, applies the schema, logs the queue depth, and drains the queue until stopped (SIGTERM or Ctrl-C); whenever the queue is idle it gives the tick to a queued health check, the thumbnail sweep, the enrichment pass or the care pass instead (below). `python -m fern --enrich <species id>` runs that pass for one species by hand, prints its journal line, and exits; it needs no Pl@ntNet key. `python -m fern --care <species id>` does the same for the care sheet (exit 2 with no model configured, 1 when the call or the answer fails, leaving the row as it was).

The care sheets add three optional variables: `AI_GATEWAY_API_KEY` (the Vercel AI Gateway key; unset, the care pass is off), `CONSERVATORY_LLM` (the gateway's model slug, default `anthropic/claude-sonnet-5.5`) and `CONSERVATORY_ZONE` (the household's USDA hardiness zone, `6a`; unset or unparseable, sheets are written without one, and a set-but-invalid value logs a warning). On start Fern logs one line saying which: `care sheets: on, anthropic/claude-sonnet-5.5, zone 6a` or `care sheets: off (AI_GATEWAY_API_KEY is not set)`.

Health checks use the same key and add one variable of their own: `CONSERVATORY_HEALTH_LLM` (the gateway slug for health checks, default `anthropic/claude-sonnet-5.5`), apart from `CONSERVATORY_LLM` so another model can be tried on health checks without touching care sheets. The start line is `health checks: on, anthropic/claude-sonnet-5.5, effort medium` or `health checks: off (AI_GATEWAY_API_KEY is not set)`. The household's daily cap, `CONSERVATORY_HEALTH_DAILY_MAX`, is the web app's to read ([web.md](web.md)), since the web app is what queues a check.

Fern reads all of these from its process environment and never loads a `.env` file. On orchid systemd supplies them; for a local run, export the root `.env` (a copy of `.env.example`) into the shell first: `set -a; . ./.env; set +a`.

## The database

`fern/db.py` is the one place that opens the file for writing from Python. `connect(path)` creates parent directories, opens SQLite with `journal_mode=WAL`, `synchronous=FULL`, `foreign_keys=ON`, and a 5 s `busy_timeout` (the web app writes to the same file), then applies the schema.

**Schema ownership.** `fern/schema.sql` is the baseline, version 1, and is idempotent: every statement is `CREATE ... IF NOT EXISTS`, so applying it to a live database is a no-op. Changes to an existing table are never edited into the baseline. They are appended to `MIGRATIONS` in `db.py` as `(version, sql)` steps; each runs once, in order, inside a transaction, and records its version in `schema_version`. The baseline may be rewritten to match only once a step has shipped to every box. `db.LATEST_VERSION` is the version a fresh database comes up at: **10** today (v2 is the enrichment columns on `species`, v3 the `care_sheets` table, v4 `photos.thumb_at`, v5 the `specimens` rebuild for pot tags, v6 `specimens.hero_photo_id`, v7 the drop of `specimens.nickname`, v8 the common-name backfill, v9 `species.hero_photo_id`, v10 the `health_checks` table, all below).

**Table rebuilds.** A change SQLite's `ALTER TABLE` cannot make (v5's `AUTOINCREMENT`) is SQLite's documented rebuild: create the new table, copy every row with its id, drop the old, rename the new, recreate its indexes. Such a step carries a third element, `FOREIGN_KEYS_OFF`, because with foreign keys on, `DROP TABLE` first deletes the old table's rows and the cascades take their children with them (for `specimens`, every `confirmations` row, and every `photos.specimen_id` set to NULL). `PRAGMA foreign_keys` cannot change inside a transaction, so `_apply_rebuild` commits, turns foreign keys off, runs the step and its `schema_version` row in one explicit transaction, runs `PRAGMA foreign_key_check` before the commit (any row it returns rolls the step back with an `IntegrityError` naming the first broken link), and turns foreign keys back on in a `finally`. A failed check leaves the database exactly as it was, and Fern does not start until the step is fixed. The web app never creates or alters tables; it trusts that Fern ran first, and `web/lib/db.ts` returns empty counts when the file does not exist yet.

**Tables.** All timestamps are ISO 8601 text in UTC.

| Table | Holds | Notes |
| --- | --- | --- |
| `photos` | one uploaded photo | `path` relative to `CONSERVATORY_DATA`; `organ` is the Pl@ntNet hint (`leaf`, `flower`, `fruit`, `bark`, `auto`); linked to a job and, once confirmed, a specimen, or to a specimen alone when added from the plant's page (#26), or to neither for the moment between its upload and its plant's job (#58; the web app sweeps one left that way for a day). v4 adds `thumb_at`: when the idle sweep wrote a job-less photo's thumbnail, NULL until then and always for job photos |
| `jobs` | one identification request | `status`: `queued` → `identifying` → `identified` or `rejected` (Pl@ntNet 404, no candidates) or `failed` (retry after `next_attempt_at`); `quota_remaining` is Pl@ntNet's count after the call |
| `candidates` | Pl@ntNet's ranked answers for a job | `kind` is `species`, `genus`, or `family` (the rollups from `detailed=true`); `common_names` is a JSON array |
| `species` | a taxon the household has confirmed | `scientific_name` may be a species, a genus alone, or whatever the person typed; `cultivar` is the nursery-tag name; unique on the pair. v2 adds the columns the enrichment pass fills (listed under Enrichment); all nullable. `common_name` is written first by the confirm route, the tapped candidate's first Pl@ntNet common name (#62), and by enrichment from GBIF only when still empty. v8 is a data-only step that filled it once, where empty, from the candidates of the jobs that named each species (the candidate with the species' name, species rows before genus, earliest confirmation first). v9 (#77) adds `hero_photo_id`, the photo the species is known by, chosen on its page (`REFERENCES photos(id) ON DELETE SET NULL`): NULL means the newest of its plants' main photos, and the web app counts a stored id only while that photo is on a plant of the species |
| `specimens` | the plant in the pot | `location` is free text (a shelf, a bed); `status` `alive`, `gifted`, `died`. v5 (#36) rebuilds it with `id INTEGER PRIMARY KEY AUTOINCREMENT`: a printed pot tag opens `/t/<id>` for years, and a plain `INTEGER PRIMARY KEY` hands the highest id out again once its row is deleted. Copying the rows seeds `sqlite_sequence` with the highest id, so nothing at or below it is reused. v5 also adds `tagged_at`, when the plant's tag was last printed and marked as tagged (the web app's `POST /api/tags`), NULL until then. v6 (#46) adds `hero_photo_id`, the photo the plant is known by, chosen on its page (`REFERENCES photos(id) ON DELETE SET NULL`): NULL means its newest, so removing the chosen photo puts the plant back on its newest. A later rebuild of `specimens` must carry it. v7 (#47) drops `nickname` with `ALTER TABLE ... DROP COLUMN` (SQLite 3.35+; the column was in no index, view or trigger, so no rebuild): a plant goes by its species' name, and the baseline's column exists only until v7 runs. Lineage and events arrive in Phase 3 as migration steps |
| `confirmations` | what the person tapped for a job | `chosen_rank` or `typed_name`; feeds the roster match and the accuracy picture |
| `care_sheets` | one species' care sheet (v3) | keyed on `species_id`, cascading on delete; columns under The care pass |
| `health_checks` | one health check of a plant (v10, #87) | inserted `queued` by the web app, answered once by Fern; cascades with its specimen; `id` is `AUTOINCREMENT`; columns under The health check |

Tests: `test_fern_db.py` at the repo root covers the baseline apply, idempotence, migration ordering, v4 over a v3 database, v5 over a v4 database (every id, photo link and naming record kept, both indexes recreated, `tagged_at` added, foreign keys back on; the test fails if the rebuild runs with foreign keys on), that a removed plant's id is never reused after v5, that a rebuild breaking a link rolls back, and the status constraint.

## The queue (`fern/queue.py`)

One job at a time, oldest first. `claim_next` picks the oldest job that is `queued`, or `failed` with its `next_attempt_at` passed and attempts left, and marks it `identifying` in the same transaction. `record_outcome` applies what Pl@ntNet said:

| Outcome | Job becomes | Notes |
| --- | --- | --- |
| `identified` | `identified`, candidates written, `quota_remaining` set | the species rows plus genus and family rollups |
| `rejected` | `rejected` | Pl@ntNet answered 404 (not a plant, or nothing found), or 200 with no species; the confirm screen shows the name field only |
| `quota` | back to `queued`, no attempt counted | the worker pauses until `Retry-After` (an RFC 7231 date) or the next UTC midnight |
| `retry` | `failed` with `next_attempt_at` | network errors and 5xx: 30 s, 60 s, 120 s, 240 s, 480 s, then it stays `failed` with its error after five attempts |
| `failed` | `failed` for good | 400, 401 (a bad key), 403, 413, 415 |

Timestamps are ISO 8601 UTC text in the shape the schema's defaults write, so string comparison orders them. The thumbnail (`<stem>.thumb.jpg`, 320 px) is written for every processed job, rejected ones included, because the confirm screen shows the photo either way. A photo added straight to a plant has no job, and gets its thumbnail from the worker's sweep instead (below).

## The Pl@ntNet client (`fern/plantnet.py`)

`identify` POSTs the job's photos (at most five, re-encoded to 1280 px JPEG by `prepare_image`, which also handles HEIC through pillow-heif) to `/v2/identify/all` with `organs` in the same order, `nb-results=5`, `detailed=true`, rejection on. The key goes in the `api-key` query parameter and comes only from the environment. Everything that decides what a response means is pure:

- `parse_candidates` takes the `results` list in rank order (name, genus, family, score, GBIF id, up to three common names) and adds **genus and family rollups**: from `otherResults` when the API sends them, otherwise computed here by summing species scores per genus and per family. With `detailed=true` the API does send them (confirmed live 2026-10-31: five genus rows and five family rows per job, with their own scores, including genera that appear in no species row, e.g. Sedum 0.79 and Pachyphytum 0.06 beside Sedum pachyphyllum 0.67), so the computed sum is only the fallback. The rollups exist because of Phase 0 (#1): a shelf succulent often comes back as three species of one genus at 0.03 each, and the genus row is what the confirm screen should lead with.
- `classify` maps the HTTP status to an `Outcome` as in the table above.

Tests: `test_fern_plantnet.py` (parser and classifier, with fixtures shaped on the Phase 0 responses) and `test_fern_queue.py` (backoff, claim order, each outcome's effect on the row, `worker.run_once` with a fake identify function, the thumbnail sweep, and the idle tick's order).

## The worker (`fern/worker.py`)

`run_once` claims a job, prepares its photos, calls identify, records the outcome, writes thumbnails, and logs one line: `job 7: identified Ficus elastica 0.80 (quota left 487)`. `run_forever` repeats it: one second between jobs, a pause until the reset time after a quota outcome, and when the queue is idle one call to `idle_tick`, which gives the tick to the first of these with work: a queued health check (`health.run_once`), the thumbnail sweep (`sweep_once`), the enrichment pass (`enrich.run_once`), the care pass (`care.run_once`). Each does one check, one photo or one species, then a second of sleep; two when none had anything. The health check leads because someone pressed a button and is waiting on the page. The queue always wins the tick: an upload never waits behind Wikipedia, and behind at most one model call. The clock and the identify function are parameters so the tests run without the network.

**The thumbnail sweep** (`sweep_once`, schema v4) exists for photos added straight to a plant from its page (`POST /api/plants/[id]/photos`), which have no job and so never pass through `run_once`. It picks the oldest photo with no `job_id` and no `thumb_at`, writes its 320 px thumbnail with `plantnet.write_thumbnail`, stamps `thumb_at`, and logs `photo 12 (specimen 3): thumbnail written`. It goes ahead of enrichment because its photo is on a page someone is looking at, so a new photo has its thumbnail within a couple of seconds of an idle queue. The row is stamped whatever happens: an unreadable file is one warning line (`photo 12 (specimen 3): photos/2026/11/<uuid>.jpg unreadable, no thumbnail: ...`) and never a stall. Job photos keep their thumbnail from `run_once` and never read the column. A photo of a plant still being sent from `/add` (#58) has no job yet either, so the sweep may write its thumbnail first and `run_once` writes it again when the job runs: harmless, and the web app's stray sweep removes the thumbnail with the photo should the job never come. Rejected: looking for the thumbnail file on disk instead of a column (no migration, but a stat of every job-less photo on every idle tick, forever), and having the browser make the thumbnail (a desktop browser cannot decode HEIC, and there would be two thumbnail makers). Until the sweep has run, the web app's media route serves the original in the thumbnail's place ([web.md](web.md)).

## Enrichment (`fern/enrich.py`)

Once per species, the worker fills in what the species *is*: its taxonomy from GBIF, its summary and reference image from Wikipedia. The web app reads these and never calls either source. The pass is worklist-driven and idempotent: `worklist(conn, now)` picks species with no `enriched_at` (oldest first), then those whose last pass left an `enrich_error` and is older than `RETRY_AFTER` (a day). A species enriched without error is never picked again; `--enrich <id>` is the way to redo one. So on the first deploy every existing species is on the list and gets its pass within the first minute, and a species confirmed later is enriched on the next idle tick.

**One species, three steps** (`enrich_species`):

1. **GBIF match.** `GET api.gbif.org/v1/species/match?name=<name>&kingdom=Plantae`, where `<name>` is `match_name(scientific_name)`: the row's name with any cultivar someone typed into it stripped (`Ficus elastica 'Ruby'` → `Ficus elastica`; the `cultivar` column never goes anywhere). `parse_match` accepts a match at rank species (or subspecies, variety, form) or genus with `confidence` ≥ 80 and a `matchType` other than NONE. The rank is the real test, not the confidence: GBIF answers a nonsense name with kingdom Plantae at confidence 99 (`HIGHERRANK`). A genus-level match is accepted on purpose, because most of a succulent shelf is a genus with a nursery tag. The ranks come back on the match itself and overwrite `genus` and `family` (Pl@ntNet's copies) along with the new columns; `scientific_name` is never rewritten, it is the confirmed name and half of the unique key. A second call, `/v1/species/<key>/vernacularNames`, supplies `common_name` (the first English entry) when the row has none: a species named from a Pl@ntNet pill already carries the pill's common name, the one the person saw, and keeps it, so GBIF's is the fallback for a typed name, a genus pill, or a candidate Pl@ntNet gave no common name (GBIF has none in English for *Peperomia ferreyrae*, which Pl@ntNet calls Happy bean). A miss is recorded in `enrich_error` (`GBIF: no match for 'Blorbus nonsensicus'`) and the pass carries on to Wikipedia with the name as typed.
2. **Wikipedia.** One query to the Action API (`en.wikipedia.org/w/api.php`: `prop=extracts|pageimages|info|pageprops`, `exintro`, `explaintext`, `piprop=original|name`, `redirects=1`, `maxlag=5`) by GBIF's canonical name, so a genus row looks up the genus article and a synonym follows the redirect. `parse_page` gives the lead paragraphs (`summary`), the article URL (`summary_url`), and the page image. A page marked `missing` is the 404 case and not an error: the row is stamped enriched with no summary. A disambiguation page (`Iris` is an eye part, a colour and a goddess before it is a plant) is retried once as `<name> (plant)`, Wikipedia's convention for the botanical article. The REST `page/summary` endpoint was deliberately not used: it is in gradual deprecation (the Aviary's `species_profile.py` litigated this in 2026), while the Action API is the long-stable path and takes `maxlag`, which a non-interactive job is supposed to send.
3. **The reference image.** The page image's original is downloaded only when it is a raster (`.jpg`, `.jpeg`, `.png`; range maps arrive as SVG), re-encoded exactly like a photo with `plantnet.prepare_image` (1280 px JPEG) to `reference/<species id>.jpg` under `CONSERVATORY_DATA`, with a 320 px `<id>.thumb.jpg` beside it from `plantnet.write_thumbnail`. `image_credit` is `"<page title> · Wikipedia"`, `image_source_url` the Commons file page, where the licence lives. Nothing under `photos/` is read or written, and the web app shows the owner's photos ahead of this image everywhere.

Every pass stamps `enriched_at`; `enrich_error` is NULL when both sources answered, else what fell short. A transport failure (DNS, a 5xx, a timeout) is caught in `run_once`, logged as one loud line (`enrich Ficus elastica (species 1) FAILED: ConnectionError: ...`), and stamped the same way, so the row waits out `RETRY_AFTER` rather than being retried on the next tick. A success logs one line: `enriched Ficus elastica: GBIF 7835333 (Moraceae), Wikipedia summary 405 chars, image 1280x960`.

**The columns (v2 on `species`).**

| Column | From | Holds |
| --- | --- | --- |
| `gbif_key`, `rank`, `canonical_name`, `authorship` | GBIF match | the backbone usage key; `species`, `genus`, `subspecies`, `variety` or `form`; GBIF's spelling; the author string (`Roxb.`) |
| `kingdom`, `phylum`, `class`, `order_`, `family`, `genus` | GBIF match | the ranks (`order_` because ORDER is a keyword) |
| `common_name` | GBIF vernacular names | the first English name, only when the confirm route left it empty |
| `summary`, `summary_url` | Wikipedia | the lead paragraphs, plain text; the article |
| `image_path`, `image_credit`, `image_source_url` | Wikipedia / Commons | `reference/<id>.jpg` relative to `CONSERVATORY_DATA`; the credit line; the Commons file page |
| `enriched_at`, `enrich_error` | the pass | when it last ran; why it fell short, else NULL |

The existing `gbif_id` (text, copied from the Pl@ntNet candidate at confirm time) is left as it was; `gbif_key` is the match's own key and the two can differ for the same plant, because Pl@ntNet's ids are not always backbone keys.

The wire is two functions (`get_json`, identified by a `User-Agent` naming this repo, with one patient retry on a 503 because that is how `maxlag` answers; `get_bytes` for the image) and both are parameters of `enrich_species` and `run_once`, so the tests replace them.

Tests: `test_fern_enrich.py` covers `match_name`, the GBIF match parser (species, genus, the kingdom and NONE misses, the confidence line), the vernacular picker, the page parser (summary and image, no image, SVG skipped, missing, disambiguation), the v2 migration over a Phase 1 database with its rows intact, the worklist order and the retry window, one species end to end with the wire faked (the row, the files, the journal line, and that `photos/` is untouched), the GBIF-miss and genus-page cases, the disambiguation retry, and that a failing fetch is one loud line and no loop. HTTP and the download itself stay untested.

## The care pass (`fern/care.py`, `fern/llm.py`)

Once per species, the worker writes how to keep it alive: six cells (light, water, soil, hardiness, fertilizing, dormancy), each a short headline, two or three sentences, and the figures behind them (a label, a value, and the basis the model gave for it). The web app reads the sheet and never calls the model; a page render never waits on one.

**What it is written from.** Only a species GBIF has placed (`gbif_key` set): `build_prompt` gives the model the name, the common name, the cultivar from the tag, GBIF's ranks, the household's zone, and the first two sentences of the Wikipedia lead (`first_sentences`, capped at 400 characters), never the whole article. The same facts are stored with the sheet as `notes`. **Genus or species** (`care_level`): a row of rank genus, or a name with a hybrid marker (`×`, or ` x ` between words), gets a sheet written for the genus as a whole, since that is the level nursery plants are named to and care works at; anything else is written for GBIF's spelling of the species.

**The instructions** live in `fern/prompts/care_sheet.md`, with `prompt_version` in its front matter. They ask for one JSON object with the six keys, written plainly for keen amateurs reading on a phone beside the plant, with the zone named in the hardiness headline, ranges rather than false precision, and a basis on every figure. Bumping `prompt_version` has every sheet written under an older one rewritten, one per idle tick.

**The validator** (`parse_answer`) is what stands between the model and the page. It takes the outermost `{…}` (so a code fence or a stray sentence is forgiven), requires all six cells, a headline of at most 60 characters, text of 40 to 600, at most four figures each with label, value and basis, collapses whitespace, and drops keys beyond the six. Anything else is an `InvalidAnswer`. Structured outputs were not used: the gateway's Messages passthrough is the plainest path, and a validator the tests can drive covers the same ground.

**The worklist** (`worklist`) picks, oldest species first, those with no sheet; then sheets with no error written under an older `prompt_version` or for another zone (so changing `CONSERVATORY_ZONE` rewrites them all); then failed attempts whose `tried_at` is older than `RETRY_AFTER` (a day). Rewrite on the species page deletes the row (`POST /api/species/<id>/care`, see [web.md](web.md)), which puts the species back at the head of the list.

**The columns (v3, `care_sheets`).**

| Column | Holds |
| --- | --- |
| `species_id` | the species, primary key, `ON DELETE CASCADE` |
| `zone`, `model`, `prompt_version` | what the sheet was written for and by: the parsed zone or NULL, the gateway slug, the prompt file's version |
| `cells` | JSON: the six cells as the validator left them; NULL until a first sheet succeeds |
| `notes` | JSON: subject, level, common name, cultivar, taxonomy, zone, the Wikipedia sentences and `summary_url` |
| `written_at` | when the current cells were written |
| `tried_at`, `error` | the last attempt, and why it failed, else NULL |

A failure (`LlmError` from the call, `InvalidAnswer` from the validator, anything else) is one loud line, `care sheet Ficus elastica (species 1) FAILED: InvalidAnswer: water: text is too short (12 characters)`, and `stamp_failure` sets only `tried_at` and `error`, so a sheet already there keeps its cells and the page keeps showing it. A success logs one line with the tokens spent: `care sheet Ficus elastica (species 1): species-level for Ficus elastica, zone 6a, 13 figures, by anthropic/claude-sonnet-5.5, 1110 tokens in, 2243 out`.

**The model call** (`fern/llm.py`) is the Vercel AI Gateway's Anthropic Messages endpoint (`https://ai-gateway.vercel.sh/v1/messages`, `anthropic-version: 2023-06-01`, the key as a bearer token), over the standard library's `urllib` as the Aviary's gateway client does, so Fern gains no dependency. A care sheet's body is four keys: `model`, `max_tokens` (16000), `system`, `messages`. No temperature and no thinking settings: Sonnet 5.5 rejects sampling parameters and thinks on its own. `payload` and `complete` take two optional extras, which only the health check passes: `images` (each an `llm.Image`: a caption and the photo's bytes, sent as a text block and a base64 image block ahead of the facts) and `effort` (sent as `output_config.effort`). Passing neither leaves the body exactly those four keys, which a test pins. `config` takes the name of the variable the model slug is read from. A reply that stopped for `refusal` or `max_tokens`, or carries no text, is an `LlmError`; so is any HTTP or transport failure, with the status in words. `complete` is a parameter of `write_sheet` and `run_once`, so the tests never touch the network.

Tests: `test_fern_care.py` covers the validator (a clean answer, fences and prose around it, empty figures, and each rejection), the prompt file's version and keys, `build_prompt` (zone, ranks, the two sentences, genus and hybrid fallbacks, no zone), `parse_zone`, the v3 migration over a v2 database and the cascade, the worklist (taxonomy required, current sheets skipped, prompt version and zone rewrites, the retry window), `run_once` end to end with a fake model (the row and the journal line, no model configured, an invalid answer keeping the old sheet, a failed call), and `llm`'s reply parser, config and payload. The HTTP call stays untested.

## The health check (`fern/health.py`)

A plant's owner picks one to three of its photos on the plant's page, optionally asks something, and presses "Check health". The web app inserts a `health_checks` row in state `queued` and answers at once ([web.md](web.md)); Fern takes the oldest queued check on an idle tick, asks a vision model once, and writes the validated answer on the row. Checks are kept, so the page shows the latest and the history.

**No check starts by itself.** There is no schedule and no automatic check, and a check gets one attempt: a failed call or a rejected answer is one loud line and a row in state `failed` with its reason, never retried. The owner can start another. With one check in flight per plant, three photos at most and the household's daily cap, both enforced by the route, this is what bounds the bill.

**What the model is given** (`run_check`, `build_prompt`):

- The chosen photos that are still on the plant, in the order chosen, each under a line with its number and date ("Photo 2, taken Oct 31, 2026:", or "uploaded … (the date it was taken is not known)"). A photo is sent as it is stored, the web app's 1280 px JPEG; `load_image` re-encodes in memory, for the request alone, only a file the model cannot take as it is (not a JPEG, PNG, WebP or GIF by its first bytes, or over 3.5 MB). No stored file is touched. A photo that cannot be read is left out with a warning; with none left the check fails without a call.
- The species (scientific name with cultivar, common name), where the plant is kept, today's date on the station's calendar and the zone (`CONSERVATORY_ZONE`, the care sheets' variable).
- How long it has been in the household's care (`time_in_care`): "about 2 years and 3 months (acquired Aug 1, 2024)" from `acquired_on`, else "at least 2 weeks (added to the app …; when it was acquired is not recorded)" from the specimen's `created_at`. It is time in care, never the plant's age.
- The species' care sheet as its six headlines (`care_headlines`), or that none is written yet.
- The previous finished check's status and summary with its date, so the model can say better or worse.
- The owner's question, between marks and named as their words, with the instruction to answer it from the photos and to say so when the photos do not show what is described; or that no question was asked.

**The instructions** live in `fern/prompts/health_check.md`, with `prompt_version` in its front matter, read with the care pass's `load_prompt`. They ask for one JSON object and frame the answer as a reading of photos, not a diagnosis. A new version applies to checks made after it; nothing is rewritten.

**The validator** (`parse_answer`) takes the outermost `{…}` as the care validator does, and requires: `status` (`healthy`, `watch`, `needs_attention`, `cannot_tell`); `summary`, at most 200 characters (the prompt asks for 140; a model cannot count characters exactly, and the first live checks came back at 144 and 156, so the validator keeps some slack rather than throw a paid answer away); `findings`, none to four, each with `seen`, `photo` (a number among the photos sent, read leniently by `photo_number`: `"1"` and `"Photo 1"` are photo 1, and one that cannot be read or is not among the photos becomes null, never a rejection, since the first live check with two photos came back with the number as text), `likelihood` (`likely`, `possible`) and `remedy`; `confidence` with `level` (`high`, `medium`, `low`) and `why`; `next_photos`, none to three. `reply` is required when the owner asked something and refused when they did not, so the page never shows an answer to a question nobody asked. Anything else is an `InvalidAnswer`; keys beyond these are dropped.

**The columns (v10, `health_checks`).**

| Column | Holds |
| --- | --- |
| `id`, `specimen_id` | the check; its plant, `ON DELETE CASCADE` |
| `state` | `queued` (the web app's insert) → `running` → `done` or `failed` |
| `photo_ids`, `question` | JSON array of the `photos.id` chosen, in order, kept as sent (a photo removed later leaves the check); the owner's question or NULL |
| `status`, `summary`, `answer` | once done: the status, the sentence, and the whole validated answer as JSON |
| `model`, `prompt_version`, `input_tokens`, `output_tokens` | what was asked, under which prompt, and what it cost |
| `error` | why it failed, as `<Kind>: <words>` (`LlmError`, `InvalidAnswer`, `LookupError`, `Interrupted`, `Off`), which the web app turns into a sentence |
| `created_at`, `finished_at` | when it was queued (the daily cap counts these) and when Fern finished with it |

A success logs one line: `health check 12 (specimen 3, Ficus elastica): watch, 2 findings, 3 photos, a question, by anthropic/claude-sonnet-5.5 at effort medium, 5810 tokens in, 2950 out`. A failure logs `health check 12 (specimen 3) FAILED: LlmError: the gateway has no credits to bill (402)`. Two cases never reach the model: a check left `running` when Fern stopped is failed at the next start (`fail_interrupted`), since nothing would finish it and it would block its plant's next check; and a queued check found with no model configured is failed with that reason rather than left waiting.

**The model** is `CONSERVATORY_HEALTH_LLM` at effort `medium` (`output_config.effort`), through `llm.complete` with the photos as image blocks. `complete` is a parameter of `run_check` and `run_once`, so the tests never touch the network.

Tests: `test_fern_health.py` covers the validator (a clean answer, fences and prose around it, a healthy plant with nothing to note, the reply with a question, and each rejection), the prompt file's version and keys, `build_prompt` (time in care with and without `acquired_on`, the spans, no care sheet, with and without a question, a previous check, no zone), the photo caption, `media_type`, the v10 migration over a v9 database with the cascade, the worklist, a check end to end with a fake model (the row, the tokens, the journal line), a failed call and an invalid answer (failed, not retried, a new check runs), photos removed since, no model, a check interrupted by a stop, the idle tick's order, and `llm.payload` with images and effort and unchanged without them.
