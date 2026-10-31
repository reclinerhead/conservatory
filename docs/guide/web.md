# The web app

`web/` is a Next.js 16 App Router app on the Aviary's stack: React 19 with the React Compiler, TypeScript, Tailwind CSS 4, `node:sqlite` for the database, pnpm, Vitest. It serves every page a person sees and writes the rows their actions create. It never calls Pl@ntNet.

## Running it

```powershell
cd web
pnpm install
pnpm dev
```

`allowedDevOrigins` in `next.config.ts` lets a phone on the house subnet reach the dev server. `pnpm test` runs Vitest once; `pnpm build` is the production build the boxes run with `pnpm start`.

## Reading the database

`lib/db.ts` opens `CONSERVATORY_DB` with `node:sqlite`'s `DatabaseSync`: `openReadOnly` for pages (returns `null` when the file does not exist yet, so a fresh checkout renders honest zeros instead of crashing) and `openReadWrite` for the routes that record a person's actions (sets a 5 s busy timeout because Fern writes to the same file, and foreign keys on). The environment is read with bracket access (`process.env["CONSERVATORY_DB"]`) on purpose: Next inlines a static `process.env.FOO` at build time, and these values belong to the box at runtime. Pages and routes that read the database export `dynamic = "force-dynamic"` so their answers come from the request, never from the build. `dataDir()` resolves `CONSERVATORY_DATA` the same way.

## Routes

| Route | What | Status |
| --- | --- | --- |
| `/` | The home page: masthead with the ledger (plants, species, places), the "waiting for a name" strip, the collection grid, the credit footer | #5 |
| `/add` | Upload from the camera or the camera roll; see below | #6 |
| `POST /api/photos` | One photo in, one queued job out | #6 |
| `GET /api/jobs/[id]` | A job's state, its photos, and its candidates once Fern has answered | #6 |
| `GET /media/photos/[yyyy]/[mm]/[file]` | A photo or its thumbnail from the data directory | #6 |
| `/name` | Sends the person to the oldest plant waiting for a name, or says there is none | #7 |
| `/name/[id]` | The confirm screen, one plant per screen; see below | #7 |
| `POST /api/jobs/[id]/confirm` | Put a name on the plant: a pill (`kind`, `rank`), a `typedName`, or `sameAsSpecimenId`, plus an optional `cultivar` | #7 |
| `DELETE /api/jobs/[id]/confirm` | "Change": reverse a naming | #7 |
| `POST /api/jobs/[id]/dismiss` | "Not a plant": delete the job, its photos and their files | #7 |
| `POST /api/jobs/[id]/photos` | Another photo of the same plant; sends the job back to Fern | #7 |
| `GET /api/species?q=` | Species already in the collection, most-owned first, for the name field | #7 |
| `/plants/[id]` | A specimen | #8 |

## Adding a plant

Both of the README's flows go through the same page and the same route. `components/uploader.tsx` is the client side:

- **Two inputs.** "Take a photo" is a file input with `capture="environment"`; "Choose from the camera roll" is one with `multiple`. Either appends to the same list. Each photo gets an organ chip row (let it guess, leaf, flower, fruit, bark) that becomes Pl@ntNet's hint.
- **Shrink before sending** (`lib/shrink.ts`): `createImageBitmap` with orientation from EXIF, drawn to a canvas at most 1280 px on the long side, JPEG at 0.9. A 4 MB phone photo becomes about 300 KB, which is the difference between working and not on a weak Wi-Fi. If the browser cannot decode the file (HEIC on a desktop browser), the original is sent and Fern re-encodes it.
- **The date survives the shrink** (`lib/exif.ts`): the re-encode drops EXIF, so `DateTimeOriginal` is read from the original bytes first, by a minimal APP1 walk, and sent as `takenAt`.
- **One request per photo, with retry** (`lib/retry.ts`): four tries with doubling waits from 800 ms, so a drop on photo seven keeps one through six. A 4xx is `NoRetry`. Each row shows its own state and try count.
- **Then it polls.** Queued jobs are fetched from `/api/jobs/[id]` every 1.5 s until they settle, and the row shows the top species with its common name and score, "No match" for a rejection, or the error. That is the on-the-spot flow's answer; the confirm screen (#7) is where the name goes on.

`POST /api/photos` writes the file to `photos/yyyy/mm/<uuid>.<ext>` under the data directory (dated by upload in UTC, extension from the MIME type, anything unknown stored as jpg for Fern to re-encode), then inserts the `jobs` row and the `photos` row in one `BEGIN IMMEDIATE` transaction. Limits: 25 MB, image types only. `GET /media/...` serves originals and thumbnails with a year-long immutable cache (names are UUIDs and a file is written once) behind `mediaRelPath`, a guard that accepts exactly the shape the upload route writes. A thumbnail Fern has not written yet is a quiet 404.

Tests: `lib/photos.test.ts` (paths, the media guard, MIME mapping), `lib/exif.test.ts` (the APP1 walk against hand-built JPEGs, both byte orders, the IFD0 fallback), `lib/retry.test.ts`.

## Naming a plant

`components/namer.tsx` is the confirm screen, one plant per screen, and it serves both flows: a person walking a strip of waiting photos, and one standing in front of the plant whose job has not settled yet (the screen polls `/api/jobs/[id]` every 1.5 s with the pill area reserved until Fern answers). What is on it, and why:

- **The pills** come from `lib/pills.ts` (`planPills`, pure, tested on the three shapes from the Phase 0 run). Three rules: the top three species lead when the best score is confident; when the top three agree on a genus and the best species score is under 0.30, a **genus pill** leads ("Echeveria · species unsure", scored from the API's genus row or, failing that, the sum of the species scores); when the best score is under 0.10 and the genera disagree, the screen is in its **low-confidence state** and the name field comes first. Scores stay on every pill, never shown as 0%.
- **One tap names it.** A pill, the "Name it" button, a roster chip, or "Same plant as the last one" all call `POST /api/jobs/[id]/confirm` and the save is immediate: there is no batch save. The route finds or creates the species (looked up by hand, case-insensitively, because `UNIQUE(scientific_name, cultivar)` does not catch two NULL cultivars), creates the specimen, links the job's photos and writes the `confirmations` row in one transaction. The optional **nursery-tag field** becomes the species' `cultivar`.
- **The name field** autocompletes over `GET /api/species`, the roster match: species the household already owns, most-owned first, so the second pot of anything is one tap. A typed name the collection does not know becomes a species row with the typed text as `scientific_name` and no GBIF id; the enrichment pass (Phase 2) resolves it.
- **Change** (`DELETE .../confirm`) reverses a naming cleanly: the confirmation goes, the photos unlink, the specimen is deleted if nothing else is attached to it and the species if no specimen is left, and the job is back in the strip. The pills were never discarded, so they reappear as they were.
- **Skip for now** is a link to the next waiting job; the skipped one stays in the strip. **Not a plant** is two taps on purpose (mis-taps are common) and then deletes the job, its photos and their files. **Add another photo of this plant** stores a second photo on the same job and sends it back to the queue; the old pills stay until the new ones arrive.
- **Next** goes to the next waiting job, computed server-side (`nextWaitingJob` in `lib/jobs.ts`, tested): the next later job, wrapping to the first, or the Conservatory when nothing else waits.
- **The first glossary marks** (#10) are here: confidence, scientific name, genus (with the plant's own genus as the example), species, cultivar.

## The glossary

`lib/glossary.ts` holds every term the app explains, keyed by slug, two or three plain sentences each with a "more" link. `components/term.tsx` is the info mark from DESIGN.md §4: an 18 px ring after the term, an "i" in moss, and on tap a sage note that explains it. The note floats under the mark rather than expanding in place, so opening one never moves anything: the no-layout-shift rule outranks the mockup's inline block. An optional `example` lets a screen add a sentence about the person's own plants. `lib/glossary.test.ts` scans every `.tsx` for `<Term k="...">` and fails on a key the glossary lacks, and keeps every entry to a short paragraph.

## The visual language

Defined in [`design/DESIGN.md`](../../design/DESIGN.md), made with Claude Design before any screen was built: pale sage ground, white cards, one moss action colour with pink, amber and blue reserved for bloom, time-sensitive and water, pills for everything pressable, Fraunces for display and Nunito Sans for reading. Read it before touching UI; the two static mockups in `design/mockups/` are the reference for the dashboard and species pages. How the app wires it:

- **Tokens.** `design/tokens.css` is the Tailwind 4 `@theme`, imported from `app/globals.css`. Nothing else in `web/` defines a colour, a face, a radius or a size: a screen says `bg-sage`, `text-ink-2`, `rounded-card`, `text-h2`, `max-w-page`.
- **Fonts** are self-hosted through `next/font` in `app/layout.tsx` (Fraunces with its italic for binomials, Nunito Sans at 400, 600, 700); the variables they set feed the two font tokens, so the boxes make no font requests. The Google Fonts `@import` that DESIGN.md's tokens originally carried was removed for this reason.
- **Component recipes** (DESIGN.md §4) are written once in `globals.css` under `@layer components`: `btn` with `btn-primary`, `btn-soft`, `btn-ghost`, `btn-compact`; `chip` with `chip-on`, `chip-compact`; `card` with `card-link` for the hover lift; `tag` with `tag-bloom`, `tag-warn`, `tag-water`; `nav-pill`; `thumb`; `sp` for an italic Latin name.
- **The top bar** (`components/topbar.tsx`) is in the root layout: leaf mark and wordmark, the five nav pills (only Collection is a link until its page exists; the rest are drawn in place, muted, so the bar keeps its shape), the primary "Add a plant". The search box arrives with #8.
- **The dashboard** (`app/page.tsx`) follows DESIGN.md §5 in its Phase 1 subset: the pending strip (a sage card with three overlapping thumbs, real ones when photos are waiting, the headline and one primary button), the life list with its counts line and 3-across specimen cards (1 below 640 px, 2 below 1024), and the side column's "at a glance" stat tiles. Greeting, Today's care, filters, Blooming now and the Flower Show wait for the phases that have data for them; their space is not faked.

### Rules every screen keeps

- **No layout shift.** Empty states reserve the populated space. The pending strip keeps its height in every state and lays out its button even when hidden; the life list's empty state is drawn in the specimen card's own shape. Counts render on the server.
- **Honest zeros.** The counts say "0 specimens" rather than hiding.
- **Phone first, laptop wide.** Rows wrap, the side column is a flex sibling that drops below on a phone, card grids step down by width, chip rows wrap and never scroll sideways.
- **Tap targets** are at least 44 px tall, the buttons and chips 44 by recipe.
- **The app teaches** (#10). Every horticultural term carries an info mark; the glossary component lands with the confirm screen.

Tests: `lib/ledger.test.ts` covers the counts line and the strip's two lines. The React Compiler is on (`reactCompiler: true`), as in the Aviary.
