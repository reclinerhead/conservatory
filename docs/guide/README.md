# The Conservatory: technical guide

The living description of how the Conservatory is built and why. The root [README](../../README.md) is the design brief; this is the state of the system. Hub and spokes: read this page, then the spoke for the area you are touching, and update that spoke in the same PR as the code.

| Spoke | Covers | Read it when |
| --- | --- | --- |
| [`fern.md`](fern.md) | Fern, the Python worker: the database and its schema, the identification queue, the Pl@ntNet client, the enrichment pass, the care pass and its model call | Touching anything under `fern/`, the schema, or a job's life cycle |
| [`web.md`](web.md) | The Next.js app: routes, how it reads and writes the database, the visual language, the glossary | Touching anything under `web/` |
| [`ops.md`](ops.md) | What runs on orchid, how it deploys, how to check it, back it up and roll it back | Touching anything under `Servers/`, or the box |

Spoke to come: `flower-show.md` (the hub, Phase 4).

## The shape, in one paragraph

One SQLite file per household, in WAL mode. Fern (`fern/`) creates and migrates it, drains the identification queue, calls Pl@ntNet, and, when idle, enriches species from GBIF and Wikipedia and writes their care sheets through the Vercel AI Gateway; the web app (`web/`) opens the same file with `node:sqlite`, serves every page, and writes the rows that a person's actions create (uploads, jobs, confirmations, specimens). Photos sit on disk under `CONSERVATORY_DATA/photos/`. Both processes read their configuration from the environment (`.env.example` at the root). Nothing calls Pl@ntNet or a model but Fern, so the daily quota and the model bill each have one owner.

## Conventions

- **Tests.** Pure logic gets tests; I/O does not. Python tests are `test_*.py` at the repo root and must be named in `.github/workflows/tests.yml` by hand (there is no discovery fallback). Web tests are `*.test.ts` beside the source and run with `pnpm test` in `web/`.
- **Environment.** The web app reads `process.env["NAME"]` with bracket access so Next cannot inline the value at build time; the boxes set these at runtime.
- **Schema changes** are migration steps appended to `fern/db.py`, never edits to shipped statements. See `fern.md`.
- **Issues are the contract.** Templates in `.github/ISSUE_TEMPLATE/`, copied from the Aviary.
