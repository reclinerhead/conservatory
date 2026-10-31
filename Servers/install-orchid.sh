#!/usr/bin/env bash
# install-orchid.sh -- bring the Conservatory up on orchid (issue #9), or bring
# it current after a change to the unit files. Run WITH sudo, from the
# checkout:
#
#     sudo bash ~/conservatory/Servers/install-orchid.sh
#
# Idempotent: every step checks what is there and changes only what differs.
# It never touches the Aviary's units, Caddyfile or watcher, and never the
# data directory's contents. What it does, in order:
#
#   1. preflight: the checkout, node under nvm, pnpm, uv (or python3)
#   2. the data directory outside the checkout, owned by todd
#   3. the environment file at /etc/conservatory/conservatory.env (copied
#      from the example when missing; the key is yours to fill in)
#   4. Fern's venv (.venv/ in the checkout) and its packages
#   5. the web app's install + build
#   6. the three units + the node-path drop-in, enabled and started
#   7. what is left for you: the Pl@ntNet key if the file was new, the
#      Caddy import line, the DNS record
#
# Nothing here is a paste block: run it, read it, re-run it.

set -uo pipefail

OWNER=todd
REPO=/home/todd/conservatory
DATA=/home/todd/conservatory-data
ENVDIR=/etc/conservatory
ENVF=$ENVDIR/conservatory.env
SD=/etc/systemd/system

say()  { printf '\n==> %s\n' "$*"; }
ok()   { printf '    ok   %s\n' "$*"; }
warn() { printf '    WARN %s\n' "$*"; }
die()  { printf '\n!! STOP: %s\n' "$*" >&2; exit 1; }
as_owner() { setpriv --reuid="$OWNER" --regid="$OWNER" --init-groups --reset-env "$@"; }

[ "$(id -u)" -eq 0 ] || die "run with sudo: sudo bash $REPO/Servers/install-orchid.sh"

say "1/7 Preflight"
[ -d "$REPO/.git" ] || die "no checkout at $REPO (git clone https://github.com/reclinerhead/conservatory.git $REPO, as $OWNER)"
[ "$(stat -c %U "$REPO")" = "$OWNER" ] || die "$REPO is not owned by $OWNER"
NODE_BIN=$(ls -d /home/$OWNER/.nvm/versions/node/v2[4-9]*/bin 2>/dev/null | sort -V | tail -n 1)
[ -n "$NODE_BIN" ] && [ -x "$NODE_BIN/node" ] || die "no Node 24+ under /home/$OWNER/.nvm (node:sqlite needs it)"
as_owner bash -lc "command -v pnpm >/dev/null" || die "pnpm is not on $OWNER's login PATH (the Aviary's build needs it too; check ~/.profile)"
ok "node $("$NODE_BIN/node" --version) at $NODE_BIN; pnpm on the login PATH"
UV=/home/$OWNER/.local/bin/uv
if [ -x "$UV" ]; then
    ok "uv at $UV (Fern gets Python 3.13)"
else
    warn "no uv; Fern will use the system python3 ($(python3 --version 2>&1))"
fi
for u in aviary-web aviary-autodeploy; do
    systemctl is-active --quiet "$u" && ok "$u is running and stays untouched"
done

say "2/7 Data directory ($DATA, outside the checkout)"
if [ ! -d "$DATA" ]; then
    install -d -o "$OWNER" -g "$OWNER" -m 0755 "$DATA" || die "mkdir $DATA"
    ok "created"
else
    ok "exists"
fi
[ "$(stat -c %U "$DATA")" = "$OWNER" ] || die "$DATA is not owned by $OWNER"
as_owner mkdir -p "$DATA/photos"

say "3/7 Environment file ($ENVF)"
NEW_ENV=0
install -d -m 0755 "$ENVDIR"
if [ ! -f "$ENVF" ]; then
    install -m 0600 -o root -g root "$REPO/Servers/conservatory.env.example" "$ENVF" || die "copy the example"
    NEW_ENV=1
    ok "created from the example (the key is empty; step 7 says what to do)"
else
    ok "exists (left as is)"
fi
chmod 0600 "$ENVF"
grep -q '^PLANTNET_API_KEY=.\+' "$ENVF" || warn "PLANTNET_API_KEY is empty in $ENVF: Fern will refuse to start until it is set"
for v in CONSERVATORY_DB CONSERVATORY_DATA; do
    grep -q "^$v=" "$ENVF" || die "$ENVF lacks $v"
done

say "4/7 Fern's venv ($REPO/.venv)"
if [ ! -x "$REPO/.venv/bin/python" ]; then
    if [ -x "$UV" ]; then
        as_owner bash -lc "cd '$REPO' && '$UV' venv --python 3.13 .venv" || die "uv venv"
    else
        as_owner bash -lc "cd '$REPO' && python3 -m venv .venv" || die "python3 -m venv"
    fi
    ok "created"
else
    ok "exists ($(as_owner "$REPO/.venv/bin/python" --version))"
fi
if [ -x "$UV" ]; then
    as_owner bash -lc "cd '$REPO' && '$UV' pip install -q --python .venv/bin/python -r fern/requirements.txt" || die "uv pip install"
else
    as_owner bash -lc "cd '$REPO' && .venv/bin/pip install -q -r fern/requirements.txt" || die "pip install"
fi
as_owner "$REPO/.venv/bin/python" -c "import requests, PIL, pillow_heif" || die "Fern's packages did not import"
ok "requests, pillow, pillow-heif present"

say "5/7 Web app: install + build (as $OWNER, through a login shell)"
as_owner bash -lc "cd '$REPO/web' && pnpm install --frozen-lockfile && pnpm build" >/tmp/conservatory-build.log 2>&1 \
    || { tail -n 30 /tmp/conservatory-build.log; die "web build failed (full log: /tmp/conservatory-build.log)"; }
ok "built: BUILD_ID $(cat "$REPO/web/.next/BUILD_ID")"

say "6/7 Units"
changed=0
for u in conservatory-web fern conservatory-autodeploy; do
    if ! cmp -s "$REPO/Servers/$u.service" "$SD/$u.service"; then
        install -m 0644 "$REPO/Servers/$u.service" "$SD/$u.service" || die "install $u.service"
        changed=1
        ok "$u.service installed"
    else
        ok "$u.service unchanged"
    fi
done
install -d "$SD/conservatory-web.service.d"
DROPIN="$SD/conservatory-web.service.d/node-path.conf"
printf '# Written by Servers/install-orchid.sh: node lives under nvm, which systemd\n# does not load. Re-run the script after an nvm upgrade.\n[Service]\nEnvironment=PATH=%s:/usr/local/bin:/usr/bin:/bin\n' "$NODE_BIN" > /tmp/node-path.conf
if ! cmp -s /tmp/node-path.conf "$DROPIN"; then
    install -m 0644 /tmp/node-path.conf "$DROPIN"
    changed=1
    ok "node-path.conf -> $NODE_BIN"
else
    ok "node-path.conf unchanged"
fi
rm -f /tmp/node-path.conf
systemctl daemon-reload || die "daemon-reload"
systemctl enable --quiet conservatory-web fern conservatory-autodeploy || die "enable"
if [ "$changed" -eq 1 ]; then
    systemctl restart conservatory-web conservatory-autodeploy || die "restart"
else
    systemctl start conservatory-web conservatory-autodeploy || die "start"
fi
if grep -q '^PLANTNET_API_KEY=.\+' "$ENVF"; then
    if [ "$changed" -eq 1 ]; then systemctl restart fern; else systemctl start fern; fi || die "fern"
else
    warn "fern not started: no key yet"
fi
for i in $(seq 1 30); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3010/)" = 200 ] && break
    sleep 1
done
[ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3010/)" = 200 ] || die "conservatory-web is not answering on :3010 (journalctl -u conservatory-web -n 30)"
ok "conservatory-web answers on :3010"
ok "watcher: $(journalctl -u conservatory-autodeploy -n 1 --no-pager -o cat)"

say "7/7 Left for you"
if [ "$NEW_ENV" -eq 1 ] || ! grep -q '^PLANTNET_API_KEY=.\+' "$ENVF"; then
    echo "    - put the Pl@ntNet key in $ENVF (sudoedit), then: sudo systemctl restart fern"
fi
if ! grep -q 'Caddyfile.conservatory' /etc/caddy/Caddyfile 2>/dev/null; then
    echo "    - the Caddy door: add this line at the END of project-squirrel/Servers/Caddyfile-orchid"
    echo "          import /home/todd/conservatory/Servers/Caddyfile.conservatory"
    echo "      copy it to /etc/caddy/Caddyfile as usual, then: sudo systemctl reload caddy"
else
    ok "Caddy already imports Caddyfile.conservatory"
fi
echo "    - DNS: conservatory.lan -> 192.168.1.148 in Pi-hole's Local DNS records (pearl, and orchid's standby)"
echo "    - then: bash $REPO/Servers/check.sh"
