# Running it at the house, and at a station

What runs where, how to check it, and how to put it back. Everything the box executes lives in `Servers/`; nothing in this spoke is a paste block, it is a script you run and read. The Conservatory runs in two shapes:

- **At the house, on orchid**, beside the Aviary, for phones on the house Wi-Fi, as **`https://conservatory.lan`**. It follows `main`: merging a PR is the deploy.
- **At a field station** (kestrel, birdhouse), a small box already in another household running the Aviary and the Quarry, as **`http://<the box>/conservatory`** on the box's one origin. It follows the release channel, `conservatory-station-stable`: main with a delay, moved once nightly. Its door is the Aviary's Caddy, its gateway key is its own, and it is two hours from a keyboard, so everything here that touches a station is built to need nobody at one.

The middle is the same on every box: the same three units, the same port, the same data directory, the same environment file, the same watcher. The ends differ, keys and door, and each kind of box has its own install script for them. The sections below describe orchid first; [At a station](#at-a-station) has what differs.

## What runs, on every box

| Unit | Runs | As | From | Port |
| --- | --- | --- | --- | --- |
| `conservatory-web` | `next start`, the production build of `web/` | todd | `~/conservatory/web` | 3010 (3000 is the Aviary's) |
| `fern` | `python -m fern`, the identification worker, enrichment, care sheets and health checks | todd | `~/conservatory`, venv `.venv/` (uv, Python 3.13) | |
| `conservatory-autodeploy` | `Servers/autodeploy.sh`, the deploy watcher | root (steps demoted to todd) | `~/conservatory` | |

Caddy fronts the web app as **`https://conservatory.lan`** (`Servers/Caddyfile.conservatory`, one site block that orchid's Caddyfile imports; the house's private root, HSTS and compression come from the `lan_tls` snippet). The name is a Pi-hole Local DNS record to orchid, on pearl's Pi-hole and on orchid's standby copy.

**The data lives outside the checkout**, in `/home/todd/conservatory-data/`: the one SQLite file and the photo tree. A deploy can never reach it. Both units read their paths and keys from `/etc/conservatory/conservatory.env` (root-owned, mode 0600; systemd reads it before dropping to todd), copied from `Servers/conservatory.env.example` by the install script. The keys are in that file and nowhere else: `PLANTNET_API_KEY`, which Fern needs to start, and `AI_GATEWAY_API_KEY`, which turns on the care sheets and the health checks. Beside the gateway key, `CONSERVATORY_ZONE` (the household's USDA zone, `6a`) and optionally `CONSERVATORY_LLM` (the care sheets' model slug). Health checks (#87) have two optional variables of their own: `CONSERVATORY_HEALTH_LLM`, the model slug Fern asks (default `anthropic/claude-sonnet-5.5`; set it to try another model on health checks alone), and `CONSERVATORY_HEALTH_DAILY_MAX`, how many checks the household may start in a day by the box's own calendar (default 20; the web unit reads it, and `0` turns the button's route off). Fern makes the model calls; the web unit only sees whether the gateway key is set, to offer Rewrite and Check health. The web unit also reads `CONSERVATORY_URL`, the address every pot tag's QR code carries: `https://conservatory.lan` here, the house name and never an IP, because printed labels last years. Empty, the web app draws no codes and will not print. A box installed before pot tags (#36) gets the line by hand, as below.

The Aviary's units, Caddy config and watcher are never touched: the Conservatory has its own files, its own watcher, its own port. 3010 is the Conservatory's port on every box; a station also has 3000 (the Aviary) and 3020 (the Quarry).

## Bring-up on orchid, and after a change to the units

```
sudo bash ~/conservatory/Servers/install-orchid.sh
```

Idempotent. It checks node under nvm, pnpm on the login PATH and uv; makes the data directory; creates the environment file from the example if it is missing; builds Fern's venv and the web app; installs the three units and the `node-path.conf` drop-in (node lives under nvm, which systemd does not load, so the drop-in pins `PATH` to the versioned bin; re-run the script after an nvm upgrade); enables and starts them; and ends by listing what is left for you: the key, the Caddy import line, the DNS record. It starts Fern only once the key is in the file.

The Caddy step is the one piece that touches another repo, by one line: `import /home/todd/conservatory/Servers/Caddyfile.conservatory` at the end of the Aviary's `Caddyfile-orchid`, synced to `/etc/caddy/Caddyfile` by hand and reloaded, the same manual posture as every Caddy change in the house.

## Deploys

Merging a PR is the deploy. `conservatory-autodeploy` polls its branch every 60 s over anonymous https (the repo is public; no key on the box) and, when the branch moved, pulls `--ff-only` and acts on what changed. The branch is `CONSERVATORY_DEPLOY_BRANCH` from the environment file, which the watcher's unit reads like the other two: unset on orchid, where the default is `main`, and `conservatory-station-stable` on a station. The watcher's first journal line names it (`watching origin/main`).

| Changed | It does |
| --- | --- |
| `fern/` | `pip install` if `fern/requirements.txt` changed, then restarts `fern` |
| `web/` | `pnpm install` + `pnpm build`, then restarts `conservatory-web` **only if the build passed**; a failed build is a loud journal line and the old build keeps serving |
| `Servers/autodeploy.sh` | hands over to the new copy |
| anything else | nothing (docs, tests, design) |

Quiet ticks log nothing, so `journalctl -u conservatory-autodeploy` reads as a deploy history and silence is healthy. A dirty checkout (tracked changes) is skipped loudly once a minute until cleaned. Checking out a branch on the box pauses deploys (the branch guard) and checking the configured branch back out resumes them; a station checkout sitting on `main` is a half-finished channel flip and pauses the same way. `Servers/deploy-web.sh` is the manual path for the web app, in the one valid order (pull, install, build, restart); `autodeploy.sh --once` is a single tick by hand.

**Two things a merge never does:** change Caddy (reload by hand after a merge that touches `Caddyfile.conservatory`), and change the environment file. A variable added to the example reaches an existing box only by hand: add the line to `/etc/conservatory/conservatory.env`, then `sudo systemctl restart fern conservatory-web`, since both units read the file only when they start.

## Checking it

```
bash ~/conservatory/Servers/check.sh
```

prints the role (house or station, read off the deploy branch, or off the checkout when the root-only environment file cannot be read), the checkout and build id, each unit's state, the answer on `:3010` and at the door, the watcher's last lines and Fern's. On a station it also prints the channel's tip as last fetched and when, asks `:3010` at `/conservatory` (the root is a 404 there by design) and checks the door at `http://127.0.0.1/conservatory` through the station's Caddy. Fern's journal is one line per job: `job 7: identified Ficus elastica 0.80 (quota left 487)`, and a quota pause says when it resumes. On start it says whether care sheets are on (`care sheets: on, anthropic/claude-sonnet-5.5, zone 6a`), and each sheet is one line with the tokens it spent (`care sheet Ficus elastica (species 1): ... 1110 tokens in, 2243 out`), or one line saying why it failed. A sheet is roughly 3,500 tokens on Sonnet, a few cents, written once per species and again only on Rewrite, a new prompt version or a new zone; the gateway's dashboard has the bill. A health check is asked for by a person, never by Fern itself: the start line says `health checks: on, anthropic/claude-sonnet-5.5, effort medium`, and each check is one line with its model and tokens (`health check 12 (specimen 3, Ficus elastica): watch, 2 findings, 3 photos, a question, by anthropic/claude-sonnet-5.5 at effort medium, 5810 tokens in, 2950 out`) or one `FAILED` line with the reason, which the plant's page also shows. A check is about 6,000 tokens in (three photos) and 3,000 out, an estimated 4 cents on Sonnet 5.5; it is tried once, and the daily cap bounds a day at under a dollar by default. When the gateway's prepaid credits run out, the line says `the gateway has no credits to bill (402)`. From a phone on the house Wi-Fi, `https://conservatory.lan` should show the collection; the first visit needs the house root certificate installed (the same one the Aviary's door uses).

## At a station

A station is another household's box: kestrel and birdhouse today, each already running the Aviary and the Quarry. The Conservatory comes up beside them with one script and then looks after itself.

**One origin, one path.** A station has no names on its LAN. Its Caddy answers on `:80` whatever the visitor typed, and the file is the Aviary's: `Servers/Caddyfile.station` there carries a `handle /conservatory*` route to `127.0.0.1:3010` (reclinerhead/aviary#684), written into the file and never imported, so a missing checkout here cannot take the Aviary's door down. A port with nothing on it answers 502 on that path and nothing else. No script in this repo writes `/etc/caddy/` on any box; the station script checks the door and says what is missing.

**The base path.** The web app is built to live under `/conservatory` there: `NEXT_PUBLIC_BASE_PATH=/conservatory` in `web/.env.local`, owned by todd, beside the build ([web.md](web.md) has what the variable does). It is not in the root-only environment file because the build runs as todd, who cannot read that file; `next build` and `next start` both read `.env.local`, so build and serve agree. Orchid's `web/.env.local` has no base path; it holds the other build-time value, `NEXT_PUBLIC_PORCH_URL=https://aviary.lan/` (#131), which gives the top bar its Home link to the house's launcher. That line is written by hand, once; no install script writes it, so a rebuilt orchid needs it again, and a change to it means a rebuild.

**The release channel.** `conservatory-station-stable` is not a fork. It is fast-forward-only, never committed to, always an ancestor of main. `.github/workflows/promote-stations.yml` moves it to main's tip once nightly at 07:40 UTC (02:40 or 03:40 Eastern; forty minutes after the Aviary's promotion and twenty after the Quarry's, so no two builds start together on a J5005), and fails loudly if the branch cannot fast-forward. A fix that cannot wait for tonight: merge it to main, then `gh workflow run promote-stations.yml`; the stations deploy within a minute. The branch is created once, by hand:

```
git fetch origin && git push origin origin/main:refs/heads/conservatory-station-stable
```

**The keys.** The Pl@ntNet key is the house's, shared: the same key pasted on every box, one daily quota across the households. The gateway key is one per station, each with its own spend limit in the gateway's dashboard, so a runaway on one box cannot spend another's budget. Both are pasted into the install script's prompt and written to the environment file without being echoed or put on a command line.

**The front door.** A station's address is whatever its router handed it, so a bookmark to the IP breaks at the next lease. The bookmark is a stable public address that redirects to the box's current one: **`https://conservatory.toddtech.llc/<station>`**, a small Vercel project in `frontdoor/` (route handlers only; its setup is `frontdoor/README.md`).

| Route | Answer |
| --- | --- |
| `/<station>[/path]` | `302` to `http://<the box's last-known LAN address>/conservatory[/path]`, query string carried, `Cache-Control: no-store`. An unknown name or a station that has never reported gets a plain 404 page, no redirect. |
| `/<station>/status` | When the box last checked in, its address, its Wi-Fi interface and the Aviary's build on it: the page that answers "is that box up" from a desk. |
| `/` | A landing page that lists nothing. |

It reads the Aviary's store and writes nothing. The stations already report themselves to the Aviary's front door (`station-checkin`, every fifteen minutes and on every new lease), and this project reads the same Upstash database, preferring the read-only token; nothing new runs on a station and no new credential exists. It is 302 and `no-store`, never 301: a cached permanent redirect would bake the LAN address into the browser, the failure the door exists to end. The redirect goes to the last-known address however old the record is. The target is built from a validated IPv4 and a fixed prefix, each path segment encoded, so it can never leave the station's Conservatory (`frontdoor/lib/frontdoor.ts`, tested beside it). The link opens only from that house's Wi-Fi and lands on plain HTTP on the LAN, like the Aviary's.

**Pot tags carry the front door.** On a station `CONSERVATORY_URL` is `https://conservatory.toddtech.llc/<station>`, so a printed tag opens `…/<station>/t/<plant id>`, the door sends it to `/conservatory/t/<plant id>` on the box, and the tag survives every change of address. The install script writes the value, from the box's hostname, when the file has the house's name or nothing; a value written by hand is left alone, because tags already printed carry it.

**The bookmark rule.** Bookmarks and home-screen icons at a station point at the front door's address for that station, never at the IP, and Todd sets them on deployment day. A person who bookmarks after landing has bookmarked the IP again.

**Bring-up, and after a change to the units:**

```
git clone https://github.com/reclinerhead/conservatory.git ~/conservatory && sudo bash ~/conservatory/Servers/install-station.sh
```

`install-station.sh` is a sibling of `install-orchid.sh`, not a flag on it, and cannot touch Caddy by construction. Idempotent. In order: preflight (node 24+ wherever todd's login shell finds it, `/usr/bin/node` on a station, so no nvm is not an error; pnpm; uv; port 3010 free; the Aviary's and the Quarry's units running and untouched); the channel (a checkout on `main` is moved to `conservatory-station-stable`, so the box is never half-flipped); the data directory; the environment file, with the deploy branch and the tag address written in; the keys and the household's zone, asked for and skippable; `web/.env.local`, only if absent; Fern's venv; the database, created and migrated so the web app has one before Fern's first job; the build; the three units (the node-path drop-in only when node is under nvm, and a stale one removed); the door, checked and never written; and what is left for you. Fern starts only once the Pl@ntNet key is in the file. Re-run it after a merge that changes a unit file.

**What a station does not have yet:** a backup that leaves the box. `Servers/backup.sh` works there unchanged and its copy stays in `~/backups` until something carries it off, the same position as the Quarry's stones and the Aviary's bird records.

## Backups

The database is a WAL file with a writer that holds it open; `cp` gives you a stale copy with no error. `Servers/backup.sh` uses the sqlite backup API, which reads through the WAL, and writes `~/backups/conservatory-<date>.db` with a quick_check and the row counts printed. The photos and the species reference images are plain files: copy `conservatory-data/photos/` and `conservatory-data/reference/` beside it (the latter is cheap to lose, since `python -m fern --enrich <id>` fetches a species' image again). Off the box, monthly, and before any migration step. Schema v5 (#36) rebuilds the `specimens` table, the only step so far that copies and drops a table, so take a backup before the deploy that carries it. Schema v10 (#87) only creates the `health_checks` table and touches no existing row. Fern checks every link with `PRAGMA foreign_key_check` before committing the step; if one is broken it rolls back, Fern does not start, and its journal names the first broken link, with the data as it was.

## Rolling back

- **A bad merge of code:** fix forward. Revert the merge on main and the watcher deploys the revert within a minute. For the web app, a build that fails never restarts the unit, so a type error that CI could not see leaves the previous build serving.
- **A unit that will not start:** `journalctl -u <unit> -n 50`. The usual causes are the empty Pl@ntNet key (Fern; an empty gateway key only turns the care sheets off), a node path that moved under nvm (the web app; re-run the install script), or the environment file missing.
- **Data:** restore the newest backup to `CONSERVATORY_DB` with both units stopped (`sudo systemctl stop fern conservatory-web`), and expect to lose what was recorded since it was taken. A restore is for a lost or corrupt file, never for a change of mind.
- **Everything off:** `sudo systemctl disable --now conservatory-web fern conservatory-autodeploy`. The Aviary does not notice; on a station `/conservatory` answers 502 and nothing else changes.
- **A station that must not take tonight's promotion:** check out any other branch in `~/conservatory` on that box; the watcher reads it as pinned until `conservatory-station-stable` is checked out again.
