# Running it at the house

What runs where, how to check it, and how to put it back. Everything the box executes lives in `Servers/`; nothing in this spoke is a paste block, it is a script you run and read. The field stations (kestrel, birdhouse) wait for Phase 4; today the Conservatory runs on **orchid**, beside the Aviary, for phones on the house Wi-Fi.

## What runs on orchid

| Unit | Runs | As | From | Port |
| --- | --- | --- | --- | --- |
| `conservatory-web` | `next start`, the production build of `web/` | todd | `~/conservatory/web` | 3010 (3000 is the Aviary's) |
| `fern` | `python -m fern`, the identification worker, enrichment and care sheets | todd | `~/conservatory`, venv `.venv/` (uv, Python 3.13) | |
| `conservatory-autodeploy` | `Servers/autodeploy.sh`, the deploy watcher | root (steps demoted to todd) | `~/conservatory` | |

Caddy fronts the web app as **`https://conservatory.lan`** (`Servers/Caddyfile.conservatory`, one site block that orchid's Caddyfile imports; the house's private root, HSTS and compression come from the `lan_tls` snippet). The name is a Pi-hole Local DNS record to orchid, on pearl's Pi-hole and on orchid's standby copy.

**The data lives outside the checkout**, in `/home/todd/conservatory-data/`: the one SQLite file and the photo tree. A deploy can never reach it. Both units read their paths and keys from `/etc/conservatory/conservatory.env` (root-owned, mode 0600; systemd reads it before dropping to todd), copied from `Servers/conservatory.env.example` by the install script. The keys are in that file and nowhere else: `PLANTNET_API_KEY`, which Fern needs to start, and `AI_GATEWAY_API_KEY`, which turns on the care sheets. Beside the gateway key, `CONSERVATORY_ZONE` (the household's USDA zone, `6a`) and optionally `CONSERVATORY_LLM` (the model slug). Fern makes the model calls; the web unit only sees whether the gateway key is set, to offer Rewrite.

The Aviary's units, Caddy config and watcher are never touched: the Conservatory has its own files, its own watcher, its own port.

## Bring-up, and after a change to the units

```
sudo bash ~/conservatory/Servers/install-orchid.sh
```

Idempotent. It checks node under nvm, pnpm on the login PATH and uv; makes the data directory; creates the environment file from the example if it is missing; builds Fern's venv and the web app; installs the three units and the `node-path.conf` drop-in (node lives under nvm, which systemd does not load, so the drop-in pins `PATH` to the versioned bin; re-run the script after an nvm upgrade); enables and starts them; and ends by listing what is left for you: the key, the Caddy import line, the DNS record. It starts Fern only once the key is in the file.

The Caddy step is the one piece that touches another repo, by one line: `import /home/todd/conservatory/Servers/Caddyfile.conservatory` at the end of the Aviary's `Caddyfile-orchid`, synced to `/etc/caddy/Caddyfile` by hand and reloaded, the same manual posture as every Caddy change in the house.

## Deploys

Merging a PR is the deploy. `conservatory-autodeploy` polls origin/main every 60 s over anonymous https (the repo is public; no key on the box) and, when main moved, pulls `--ff-only` and acts on what changed:

| Changed | It does |
| --- | --- |
| `fern/` | `pip install` if `fern/requirements.txt` changed, then restarts `fern` |
| `web/` | `pnpm install` + `pnpm build`, then restarts `conservatory-web` **only if the build passed**; a failed build is a loud journal line and the old build keeps serving |
| `Servers/autodeploy.sh` | hands over to the new copy |
| anything else | nothing (docs, tests, design) |

Quiet ticks log nothing, so `journalctl -u conservatory-autodeploy` reads as a deploy history and silence is healthy. A dirty checkout (tracked changes) is skipped loudly once a minute until cleaned. Checking out a branch on the box pauses deploys (the branch guard) and checking main back out resumes them. `Servers/deploy-web.sh` is the manual path for the web app, in the one valid order (pull, install, build, restart); `autodeploy.sh --once` is a single tick by hand.

**Two things a merge never does:** change Caddy (reload by hand after a merge that touches `Caddyfile.conservatory`), and change the environment file. A variable added to the example reaches an existing box only by hand: add the line to `/etc/conservatory/conservatory.env`, then `sudo systemctl restart fern conservatory-web`, since both units read the file only when they start.

## Checking it

```
bash ~/conservatory/Servers/check.sh
```

prints the checkout and build id, each unit's state, the answer on `:3010` and at the door, the watcher's last lines and Fern's. Fern's journal is one line per job: `job 7: identified Ficus elastica 0.80 (quota left 487)`, and a quota pause says when it resumes. On start it says whether care sheets are on (`care sheets: on, anthropic/claude-sonnet-5.5, zone 6a`), and each sheet is one line with the tokens it spent (`care sheet Ficus elastica (species 1): ... 1110 tokens in, 2243 out`), or one line saying why it failed. A sheet is roughly 3,500 tokens on Sonnet, a few cents, written once per species and again only on Rewrite, a new prompt version or a new zone; the gateway's dashboard has the bill. From a phone on the house Wi-Fi, `https://conservatory.lan` should show the collection; the first visit needs the house root certificate installed (the same one the Aviary's door uses).

## Backups

The database is a WAL file with a writer that holds it open; `cp` gives you a stale copy with no error. `Servers/backup.sh` uses the sqlite backup API, which reads through the WAL, and writes `~/backups/conservatory-<date>.db` with a quick_check and the row counts printed. The photos and the species reference images are plain files: copy `conservatory-data/photos/` and `conservatory-data/reference/` beside it (the latter is cheap to lose, since `python -m fern --enrich <id>` fetches a species' image again). Off the box, monthly, and before any migration step.

## Rolling back

- **A bad merge of code:** fix forward. Revert the merge on main and the watcher deploys the revert within a minute. For the web app, a build that fails never restarts the unit, so a type error that CI could not see leaves the previous build serving.
- **A unit that will not start:** `journalctl -u <unit> -n 50`. The usual causes are the empty Pl@ntNet key (Fern; an empty gateway key only turns the care sheets off), a node path that moved under nvm (the web app; re-run the install script), or the environment file missing.
- **Data:** restore the newest backup to `CONSERVATORY_DB` with both units stopped (`sudo systemctl stop fern conservatory-web`), and expect to lose what was recorded since it was taken. A restore is for a lost or corrupt file, never for a change of mind.
- **Everything off:** `sudo systemctl disable --now conservatory-web fern conservatory-autodeploy`. The Aviary does not notice.
