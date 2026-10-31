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
| `/name` | The confirm flow, one plant per screen | #7 |
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

## The visual language: "Glasshouse, Morning"

The Aviary is a ranger station at night; the Conservatory is its daylight sibling, and the two must read as a pair without sharing a palette. Everything lives in `app/globals.css` as Tailwind theme tokens.

- **Surfaces** are limewash and paper: `glass` (the page), `pane` (the lightest panel), `pane-2` (a pressed panel, the strip). Rules are `line` and `line-strong`.
- **Ink** is the black-green of painted iron: `ink`, `ink-dim`, `ink-faint`. All three are measured against `pane`: 14.9:1, 7.3:1, 4.6:1, so `ink-faint` is AA for small text and nothing smaller than 14 px uses it.
- **Two accents, each with one job.** `moss` is anything that is a plant or a link. `terracotta` is the one action on a screen (the pot you pick up): the Add button, the first-plant link, the focus ring. Neither is decoration.
- **Type.** `font-display` is Bodoni Moda, the high-contrast didone of a botanical plate caption, for titles only. `font-body` is Alegreya Sans, warm and tall-x-height, for everything read at arm's length. Both self-hosted through `next/font`. No system fonts, no mono.
- **The mullion grid** (`.mullions`) is the one memorable mark: two faint rules every pane width over the masthead, with a wash of morning light from the upper left. The pane width and the rule's strength both step up with the viewport (56, 72, 96 px; the rule is mixed toward the pane on a phone) so it reads as a glass roof, not graph paper.
- **Motion** is one page-load reveal (`.reveal`, staggered by `--reveal-i`), off under `prefers-reduced-motion`. Nothing else moves on its own.

### Rules every screen follows

- **No layout shift.** Empty states reserve the populated space. The strip is `min-h-14` in every state and lays out its link even when hidden; the collection's empty tile and ghost tiles use the same `.tile` box (4:5) a populated tile will. Counts render on the server.
- **Honest zeros.** The ledger says "0 plants" rather than hiding.
- **Phone first, laptop wide.** 16 px gutters at phone width, the grid goes from two columns to six, the masthead stacks the button under the title on a phone and sets it beside on a laptop.
- **Tap targets** are at least 48 px tall.
- **The app teaches** (#10). Every horticultural term carries an info mark; the glossary component lands with the confirm screen.

Tests: `lib/ledger.test.ts` covers the pluralization and the strip label. The React Compiler is on (`reactCompiler: true`), as in the Aviary.
