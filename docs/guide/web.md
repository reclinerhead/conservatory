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

`lib/db.ts` opens `CONSERVATORY_DB` read-only with `node:sqlite`'s `DatabaseSync`, and returns `null` when the file does not exist yet (Fern creates it), so a fresh checkout renders honest zeros instead of crashing. The environment is read with bracket access (`process.env["CONSERVATORY_DB"]`) on purpose: Next inlines a static `process.env.FOO` at build time, and these values belong to the box at runtime. Pages that read the database export `dynamic = "force-dynamic"` so their numbers come from the request, never from the build. Writes arrive with #6 and #7.

## Routes

| Route | What | Status |
| --- | --- | --- |
| `/` | The home page: masthead with the ledger (plants, species, places), the "waiting for a name" strip, the collection grid, the credit footer | Scaffold (#5): strips reserved, grid empty |
| `/add` | Upload from the camera or the camera roll | #6 |
| `/name` | The confirm flow, one plant per screen | #7 |
| `/plants/[id]` | A specimen | #8 |

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
