# The Conservatory

Read first: the root `README.md` (the design brief) and `docs/guide/README.md` (the state of what is built, hub and spokes). Issues are the contract; the workflow is the one in the global CLAUDE.md.

UI work follows `design/DESIGN.md`. Tokens live in `design/tokens.css` (Tailwind 4 `@theme`, imported from `web/app/globals.css`, with the fonts self-hosted through `next/font` in `web/app/layout.tsx`). The static mockups in `design/mockups/` are the visual reference for the dashboard and species pages; match them, don't copy their markup. The component recipes DESIGN.md §4 describes (`btn`, `chip`, `card`, `tag`, `thumb`, `sp`) are written once in `globals.css`.

Two rules every screen keeps: no layout shift (empty states reserve the populated space), and the app teaches (every horticultural term carries an info mark, #10).
