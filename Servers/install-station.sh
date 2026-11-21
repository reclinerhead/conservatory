#!/usr/bin/env bash
# install-station.sh -- bring the Conservatory up on a field station
# (birdhouse, kestrel; issue #113), or bring it current after a change to a
# unit. Run WITH sudo, from anywhere:
#
#     sudo bash ~/conservatory/Servers/install-station.sh
#
# The first time, clone the repo first (as todd, not root):
#
#     git clone https://github.com/reclinerhead/conservatory.git ~/conservatory && sudo bash ~/conservatory/Servers/install-station.sh
#
# A sibling of install-orchid.sh, not a flag on it: the two boxes share the
# middle (venv, build, units) and differ at both ends (keys and door), and
# this script must be unable to touch Caddy by construction. A station is a
# guest in a house two hours from a keyboard: it rides the release channel
# (conservatory-station-stable, main with a delay), its door is the Aviary's
# Caddyfile (synced by hand, never by this script), its gateway key is its
# own, with its own spend limit, and its pot tags carry its front door's
# address.
#
# Idempotent: every step checks what is there and changes only what differs.
# It never touches the Aviary's or the Quarry's units, env files, watchers or
# checkouts, never /etc/caddy, and never the data directory's contents. In
# order:
#
#   1. preflight: the checkout, the station's name, node 24+ through todd's
#      login shell (/usr/bin on a station; nvm is fine too, and no nvm is not
#      an error), pnpm, uv, port 3010, the Aviary and the Quarry still running
#   2. the channel: the checkout moves from main to conservatory-station-stable
#   3. the data directory outside the checkout, owned by todd
#   4. the environment file at /etc/conservatory/conservatory.env (copied from
#      the example when missing, left alone when you wrote it yourself) with
#      CONSERVATORY_DEPLOY_BRANCH=conservatory-station-stable in it, and
#      CONSERVATORY_URL set to this station's front door, the address its pot
#      tags carry
#   5. the keys and the zone: the Pl@ntNet key by paste (one key, shared by
#      every box), the gateway key by paste (one key per station, with its
#      own spend limit in the gateway's dashboard), the household's USDA
#      zone. Keys are written without being echoed or put on a command line
#   6. web/.env.local with NEXT_PUBLIC_BASE_PATH=/conservatory, only if absent
#   7. Fern's venv and its packages
#   8. the database: created and migrated, so the web app has one before
#      Fern's first job, and before a key is in the file
#   9. the web app's install + build
#  10. the three units, enabled and started; the node-path drop-in only when
#      node lives under nvm
#  11. the door, checked only: http://127.0.0.1/conservatory through the
#      station's Caddy. Anything but 200 means the Aviary's Caddyfile.station
#      (reclinerhead/aviary#684) is not synced on this box
#  12. what is left for you
#
# Nothing here is a paste block: run it, read it, re-run it.

set -uo pipefail

OWNER=todd
REPO=/home/todd/conservatory
DATA=/home/todd/conservatory-data
ENVDIR=/etc/conservatory
ENVF=$ENVDIR/conservatory.env
WEB_ENV=$REPO/web/.env.local
SD=/etc/systemd/system
PORT=3010
CHANNEL=conservatory-station-stable
BASE_PATH=/conservatory
FRONTDOOR=https://conservatory.toddtech.llc
HOUSE_URL=https://conservatory.lan
CADDY_LIVE=/etc/caddy/Caddyfile
CADDY_AVIARY=/home/$OWNER/aviary/Servers/Caddyfile.station

say()  { printf '\n==> %s\n' "$*"; }
ok()   { printf '    ok   %s\n' "$*"; }
warn() { printf '    WARN %s\n' "$*"; }
die()  { printf '\n!! STOP: %s\n' "$*" >&2; exit 1; }
as_owner() { setpriv --reuid="$OWNER" --regid="$OWNER" --init-groups --reset-env "$@"; }

# The value of NAME in an env file, or nothing. Builtins only.
env_value() {
    local name="$1" file="$2" line
    [ -r "$file" ] || return 1
    while IFS= read -r line || [ -n "$line" ]; do
        if [[ "$line" == "$name="* ]]; then
            printf '%s' "${line#"$name="}"
            return 0
        fi
    done < "$file"
    return 1
}

# Rewrite the NAME= line of $ENVF, or add it when the file has none. Builtins
# only (printf and read are not processes), so a key never appears in any
# command's argv.
write_var() {
    local name="$1" value="$2" tmp line found=0
    tmp=$(mktemp "$ENVDIR/.conservatory.env.XXXXXX") || die "mktemp in $ENVDIR"
    while IFS= read -r line || [ -n "$line" ]; do
        if [[ "$line" == "$name="* ]]; then
            printf '%s=%s\n' "$name" "$value"
            found=1
        else
            printf '%s\n' "$line"
        fi
    done < "$ENVF" > "$tmp"
    [ "$found" -eq 1 ] || printf '%s=%s\n' "$name" "$value" >> "$tmp"
    chmod 0600 "$tmp" && mv "$tmp" "$ENVF" || die "could not write $ENVF"
}

has_plantnet_key() { [ -n "$(env_value PLANTNET_API_KEY "$ENVF")" ]; }
has_gateway_key() { [ -n "$(env_value AI_GATEWAY_API_KEY "$ENVF")" ]; }
has_zone() { [ -n "$(env_value CONSERVATORY_ZONE "$ENVF")" ]; }
door_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1$BASE_PATH" 2>/dev/null; }

[ "$(id -u)" -eq 0 ] || die "run with sudo: sudo bash $REPO/Servers/install-station.sh"

say "1/12 Preflight"
[ -d "$REPO/.git" ] || die "no checkout at $REPO (as $OWNER: git clone https://github.com/reclinerhead/conservatory.git $REPO)"
[ "$(stat -c %U "$REPO")" = "$OWNER" ] || die "$REPO is not owned by $OWNER"
ok "checkout at $(as_owner git -C "$REPO" rev-parse --short HEAD) on $(as_owner git -C "$REPO" rev-parse --abbrev-ref HEAD)"
# The station's name is its hostname, and the name its front door knows it by.
STATION=$(hostname -s)
[[ "$STATION" =~ ^[a-z0-9][a-z0-9-]*$ ]] || die "this box's hostname ('$STATION') is not a station name the front door could carry"
ok "this station is '$STATION'"
# Node is wherever todd's login shell finds it: /usr/bin/node from NodeSource
# on a station, nvm's versioned bin on a box that has nvm. The unit needs the
# directory only in the nvm case (step 10).
NODE=$(as_owner bash -lc "command -v node" 2>/dev/null | tail -n 1)
[ -n "$NODE" ] && [ -x "$NODE" ] || die "no node on $OWNER's login PATH (a station has NodeSource's /usr/bin/node)"
NODE_MAJOR=$("$NODE" --version | sed 's/^v//' | cut -d. -f1)
[ "$NODE_MAJOR" -ge 24 ] 2>/dev/null || die "node $("$NODE" --version) at $NODE; node:sqlite needs 24+"
NODE_BIN=$(dirname "$NODE")
case "$NODE_BIN" in
    /home/$OWNER/.nvm/*) NODE_UNDER_NVM=1 ;;
    *) NODE_UNDER_NVM=0 ;;
esac
as_owner bash -lc "command -v pnpm >/dev/null" || die "pnpm is not on $OWNER's login PATH (the Aviary's build needs it too)"
ok "node $("$NODE" --version) at $NODE; pnpm on the login PATH"
UV=/home/$OWNER/.local/bin/uv
if [ -x "$UV" ]; then
    ok "uv at $UV (Fern gets Python 3.13)"
else
    warn "no uv; Fern will use the system python3 ($(python3 --version 2>&1))"
fi
if ! systemctl is-active --quiet conservatory-web && [ -n "$(ss -ltnH "sport = :$PORT" 2>/dev/null)" ]; then
    die "something else is listening on :$PORT ($(ss -ltnpH "sport = :$PORT" | head -n 1)); the Conservatory's port must be free"
fi
ok "port $PORT is the Conservatory's"
if systemctl is-active --quiet aviary-web; then
    ok "aviary-web is running and stays untouched"
else
    warn "aviary-web is not running; nothing here touches it, but the station's door is its Caddy"
fi
for u in quarry-web quarry-autodeploy station-autodeploy station-checkin.timer; do
    systemctl is-active --quiet "$u" && ok "$u is running and stays untouched"
done

say "2/12 The channel ($CHANNEL)"
branch=$(as_owner git -C "$REPO" rev-parse --abbrev-ref HEAD)
if [ "$branch" = "$CHANNEL" ]; then
    ok "the checkout is on $CHANNEL"
elif [ "$branch" = main ]; then
    as_owner git -C "$REPO" fetch --quiet origin "$CHANNEL" \
        || die "origin has no $CHANNEL yet; create it once from main's tip: git push origin origin/main:refs/heads/$CHANNEL"
    [ -z "$(as_owner git -C "$REPO" status --porcelain --untracked-files=no)" ] || die "the checkout has tracked changes; clean it before switching channels"
    as_owner git -C "$REPO" checkout --quiet -B "$CHANNEL" "origin/$CHANNEL" || die "could not check out $CHANNEL"
    ok "moved from main to $CHANNEL ($(as_owner git -C "$REPO" rev-parse --short HEAD))"
else
    warn "the checkout is on '$branch': the watcher reads that as pinned and deploys nothing until it is back on $CHANNEL"
fi

say "3/12 Data directory ($DATA, outside the checkout)"
if [ ! -d "$DATA" ]; then
    install -d -o "$OWNER" -g "$OWNER" -m 0755 "$DATA" || die "mkdir $DATA"
    ok "created"
else
    ok "exists"
fi
[ "$(stat -c %U "$DATA")" = "$OWNER" ] || die "$DATA is not owned by $OWNER"
as_owner mkdir -p "$DATA/photos"

say "4/12 Environment file ($ENVF)"
install -d -m 0755 "$ENVDIR"
if [ ! -f "$ENVF" ]; then
    install -m 0600 -o root -g root "$REPO/Servers/conservatory.env.example" "$ENVF" || die "copy the example"
    ok "created from the example"
else
    ok "exists (left as is, but for the lines below)"
fi
chmod 0600 "$ENVF"
for v in CONSERVATORY_DB CONSERVATORY_DATA PLANTNET_API_KEY AI_GATEWAY_API_KEY; do
    grep -q "^$v=" "$ENVF" || die "$ENVF lacks a $v= line (compare it with Servers/conservatory.env.example)"
done
if [ "$(env_value CONSERVATORY_DEPLOY_BRANCH "$ENVF")" = "$CHANNEL" ]; then
    ok "CONSERVATORY_DEPLOY_BRANCH=$CHANNEL"
else
    write_var CONSERVATORY_DEPLOY_BRANCH "$CHANNEL"
    ok "CONSERVATORY_DEPLOY_BRANCH=$CHANNEL written (the watcher follows the channel, not main)"
fi
# The address this station's pot tags carry. The example's value is the
# house's name, which exists only at the house; an empty value draws no codes.
# Either becomes this station's front door. Anything else was written by hand
# and stays: tags already printed carry it.
TAG_URL=$(env_value CONSERVATORY_URL "$ENVF")
if [ -z "$TAG_URL" ] || [ "$TAG_URL" = "$HOUSE_URL" ]; then
    write_var CONSERVATORY_URL "$FRONTDOOR/$STATION"
    ok "CONSERVATORY_URL=$FRONTDOOR/$STATION written (what this station's pot tags open)"
elif [ "$TAG_URL" = "$FRONTDOOR/$STATION" ]; then
    ok "CONSERVATORY_URL=$TAG_URL"
else
    warn "CONSERVATORY_URL=$TAG_URL, not $FRONTDOOR/$STATION; left as is (printed tags carry it)"
fi
DB=$(env_value CONSERVATORY_DB "$ENVF")
[ -n "$DB" ] || die "CONSERVATORY_DB is empty in $ENVF"

say "5/12 The keys and the zone"
if has_plantnet_key; then
    ok "PLANTNET_API_KEY is set (left as is; to change it: sudoedit $ENVF, then sudo systemctl restart fern)"
elif [ ! -t 0 ]; then
    warn "PLANTNET_API_KEY is empty and nobody is at the keyboard to ask; Fern waits for it"
else
    echo "    Fern needs the Pl@ntNet key to identify anything. It is the one key every box"
    echo "    shares: the same key as the house, one daily quota across the households."
    read -r -s -p "    Paste the Pl@ntNet key (it will not show), or just Enter for not now: " new_key
    echo
    if [ -z "$new_key" ]; then
        warn "no Pl@ntNet key yet; re-run this script when you have it (everything else comes up; Fern waits)"
    elif [[ "$new_key" =~ [[:space:]] ]]; then
        die "that key has a space in it; re-run and paste it again"
    else
        write_var PLANTNET_API_KEY "$new_key"
        ok "the Pl@ntNet key is in $ENVF"
    fi
    unset new_key
fi
if has_gateway_key; then
    ok "AI_GATEWAY_API_KEY is set (left as is; to change it: sudoedit $ENVF, then sudo systemctl restart fern conservatory-web)"
elif [ ! -t 0 ]; then
    warn "AI_GATEWAY_API_KEY is empty and nobody is at the keyboard to ask; no care sheets or health checks until it is set"
else
    echo "    Care sheets and health checks need a Vercel AI Gateway key. One key per station,"
    echo "    with its own spend limit in the gateway's dashboard, so a runaway here can never"
    echo "    spend another box's budget. Without it Fern still identifies plants."
    read -r -s -p "    Paste this station's gateway key (it will not show), or just Enter to skip: " new_key
    echo
    if [ -z "$new_key" ]; then
        warn "no gateway key; no care sheets or health checks (re-run this script to add one)"
    elif [[ "$new_key" =~ [[:space:]] ]]; then
        die "that key has a space in it; re-run and paste it again"
    else
        write_var AI_GATEWAY_API_KEY "$new_key"
        ok "the gateway key is in $ENVF"
    fi
    unset new_key
fi
if has_zone; then
    ok "CONSERVATORY_ZONE=$(env_value CONSERVATORY_ZONE "$ENVF") (left as is)"
elif [ ! -t 0 ]; then
    warn "CONSERVATORY_ZONE is not set and nobody is at the keyboard to ask; care sheets are written without a zone"
else
    echo "    Care sheets say what the advice means in this household's USDA hardiness zone."
    read -r -p "    This household's zone, 1 to 13 with an optional a or b (6a), or just Enter to skip: " zone
    if [ -z "$zone" ]; then
        warn "no zone; care sheets are written without one (re-run this script to add it)"
    elif [[ "$zone" =~ ^([1-9]|1[0-3])[ab]?$ ]]; then
        write_var CONSERVATORY_ZONE "$zone"
        ok "CONSERVATORY_ZONE=$zone"
    else
        die "'$zone' is not a USDA zone (1 to 13, with an optional a or b); re-run and type it again"
    fi
    unset zone
fi

say "6/12 The base path ($WEB_ENV)"
# Build-time, so it lives beside the build, owned by todd, not in the
# root-only env file the build cannot read. Written only if absent, so
# a hand edit survives.
if [ -f "$WEB_ENV" ]; then
    if grep -q "^NEXT_PUBLIC_BASE_PATH=$BASE_PATH$" "$WEB_ENV"; then
        ok "NEXT_PUBLIC_BASE_PATH=$BASE_PATH (left as is)"
    else
        warn "$WEB_ENV exists without NEXT_PUBLIC_BASE_PATH=$BASE_PATH; left as is, but the app will not sit under $BASE_PATH until it has that line"
    fi
else
    as_owner bash -c "printf '# Written by Servers/install-station.sh (#113): the path the Conservatory is\n# served under on this station, read at build time and again by next start.\n# A change means a rebuild.\nNEXT_PUBLIC_BASE_PATH=%s\n' '$BASE_PATH' > '$WEB_ENV'" || die "write $WEB_ENV"
    ok "written: NEXT_PUBLIC_BASE_PATH=$BASE_PATH"
fi

say "7/12 Fern's venv ($REPO/.venv)"
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
    as_owner bash -lc "cd '$REPO' && .venv/bin/python -m pip install -q -r fern/requirements.txt" || die "pip install"
fi
as_owner "$REPO/.venv/bin/python" -c "import requests, PIL, pillow_heif" || die "Fern's packages did not import"
ok "requests, pillow, pillow-heif present"

say "8/12 The database ($DB)"
ver=$(as_owner "$REPO/.venv/bin/python" -c "
import sys
sys.path.insert(0, '$REPO')
from fern import db
conn = db.connect(sys.argv[1])
print(db.current_version(conn))
conn.close()
" "$DB") || die "could not create or migrate $DB"
ok "schema v$ver"

say "9/12 Web app: install + build (as $OWNER, through a login shell; about a minute on a J5005)"
as_owner bash -lc "cd '$REPO/web' && pnpm install --frozen-lockfile && pnpm build" >/tmp/conservatory-build.log 2>&1 \
    || { tail -n 30 /tmp/conservatory-build.log; die "web build failed (full log: /tmp/conservatory-build.log)"; }
ok "built: BUILD_ID $(cat "$REPO/web/.next/BUILD_ID")"

say "10/12 Units"
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
# The node-path drop-in exists for nvm, which systemd does not load. With
# node at /usr/bin the unit finds it on its own, and a drop-in left over from
# an earlier nvm would pin a directory that may not exist.
DROPIN="$SD/conservatory-web.service.d/node-path.conf"
if [ "$NODE_UNDER_NVM" -eq 1 ]; then
    install -d "$SD/conservatory-web.service.d"
    printf '# Written by Servers/install-station.sh: node lives under nvm, which systemd\n# does not load. Re-run the script after an nvm upgrade.\n[Service]\nEnvironment=PATH=%s:/usr/local/bin:/usr/bin:/bin\n' "$NODE_BIN" > /tmp/conservatory-node-path.conf
    if ! cmp -s /tmp/conservatory-node-path.conf "$DROPIN"; then
        install -m 0644 /tmp/conservatory-node-path.conf "$DROPIN"
        changed=1
        ok "node-path.conf -> $NODE_BIN"
    else
        ok "node-path.conf unchanged"
    fi
    rm -f /tmp/conservatory-node-path.conf
elif [ -f "$DROPIN" ]; then
    rm -f "$DROPIN"
    rmdir "$SD/conservatory-web.service.d" 2>/dev/null
    changed=1
    ok "removed a stale node-path.conf (node is at $NODE_BIN, on the unit's own PATH)"
else
    ok "no node-path drop-in needed (node at $NODE_BIN)"
fi
systemctl daemon-reload || die "daemon-reload"
systemctl enable --quiet conservatory-web fern conservatory-autodeploy || die "enable"
# The web app always restarts: step 9 just rebuilt it, and next start serves
# the build it loaded when it started.
systemctl restart conservatory-web || die "restart conservatory-web"
# The watcher always restarts too: it reads the channel from the env file
# only when it starts, and step 4 may have just written it.
systemctl restart conservatory-autodeploy || die "restart conservatory-autodeploy"
if has_plantnet_key; then
    systemctl restart fern || die "fern"
    sleep 3
    if systemctl is-active --quiet fern; then
        ok "fern: $(journalctl -u fern -n 1 --no-pager -o cat)"
    else
        journalctl -u fern -n 10 --no-pager -o cat | sed 's/^/    /'
        die "fern did not stay up (above: its last lines)"
    fi
else
    systemctl stop fern 2>/dev/null
    warn "fern not started: no Pl@ntNet key yet"
fi
# Under a base path the root is a 404 by design; the app answers at the path.
for i in $(seq 1 30); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$BASE_PATH")" = 200 ] && break
    sleep 1
done
[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$BASE_PATH")" = 200 ] || die "conservatory-web is not answering on :$PORT$BASE_PATH (journalctl -u conservatory-web -n 30)"
ok "conservatory-web answers on :$PORT$BASE_PATH"
sleep 1
watcher_line=$(journalctl -u conservatory-autodeploy -n 1 --no-pager -o cat)
case "$watcher_line" in
    *"origin/$CHANNEL"*) ok "watcher: $watcher_line" ;;
    *) warn "watcher: $watcher_line (expected it to say origin/$CHANNEL)" ;;
esac

say "11/12 The door (http://127.0.0.1$BASE_PATH through this station's Caddy; checked, never written)"
door_ok=0
code=$(door_code)
if [ "$code" = 200 ]; then
    door_ok=1
    ok "the door answers: Caddy routes $BASE_PATH to :$PORT"
else
    warn "the door answers $code, not 200"
    if grep -q "handle $BASE_PATH" "$CADDY_AVIARY" 2>/dev/null; then
        echo "    The Aviary's checkout has the route; the live $CADDY_LIVE does not yet. The sync is"
        echo "    the Aviary's hand step, not this script's:"
        echo "        caddy validate --config $CADDY_AVIARY --adapter caddyfile"
        echo "        sudo cp $CADDY_AVIARY $CADDY_LIVE && sudo systemctl reload caddy"
    else
        echo "    The Aviary's Caddyfile.station needs a route for $BASE_PATH to 127.0.0.1:$PORT"
        echo "    (reclinerhead/aviary#684). Once it is on the Aviary's station channel and synced"
        echo "    into $CADDY_LIVE on this box, re-run this script."
    fi
fi

say "12/12 Left for you"
left=0
if ! has_plantnet_key; then
    echo "    - the Pl@ntNet key: re-run this script and paste it when asked"
    left=1
fi
if ! has_gateway_key; then
    echo "    - the gateway key (care sheets and health checks): re-run this script and paste it when asked"
    left=1
fi
if ! has_zone; then
    echo "    - the household's zone (optional): re-run this script and type it when asked"
    left=1
fi
if [ "$door_ok" -eq 0 ]; then
    echo "    - the door: the Caddy sync above, then re-run this script"
    left=1
fi
echo "    - bookmarks and home-screen icons: $FRONTDOOR/$STATION, never this box's IP,"
echo "      which changes with the router's lease"
[ "$left" -eq 0 ] && ok "nothing else: open $FRONTDOOR/$STATION on a phone on this house's Wi-Fi"
echo "    - any time: bash $REPO/Servers/check.sh"
