#!/usr/bin/env bash
# check.sh -- is the Conservatory healthy on this box? No sudo. Reads the
# units, the port, the door, the watcher's last line and Fern's last jobs. On
# a field station it also names the release channel and when it last moved.
#
#     bash ~/conservatory/Servers/check.sh
#
# The role: the deploy watcher follows CONSERVATORY_DEPLOY_BRANCH from
# /etc/conservatory/conservatory.env (#113), which is root-only, so without
# sudo this script reads the role off the checkout instead. The install
# script keeps the two in step: a station's checkout sits on
# conservatory-station-stable, and the watcher deploys nothing while they
# disagree.

REPO="${CONSERVATORY_REPO:-$HOME/conservatory}"
CHANNEL=conservatory-station-stable

line() { printf '%-30s %s\n' "$1" "$2"; }

branch=$(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null)
role=house
deploy_branch=$(sed -n 's/^CONSERVATORY_DEPLOY_BRANCH=//p' /etc/conservatory/conservatory.env 2>/dev/null)
if [ "${deploy_branch:-$branch}" = "$CHANNEL" ]; then role=station; fi
# On a station the app is built under a base path, and the root is a 404 by design.
if [ "$role" = station ]; then BASE=/conservatory; else BASE=/; fi

echo "The Conservatory on $(hostname), $(date '+%F %H:%M') ($role)"
line "checkout" "$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null) on $branch ($(git -C "$REPO" status --porcelain --untracked-files=no 2>/dev/null | wc -l) tracked changes)"
if [ "$role" = station ]; then
    # The channel's tip as this box last fetched it, and when that fetch was.
    # The tip moves once nightly (the promote-stations Action) or by hand.
    tip=$(git -C "$REPO" log -1 --format='%h, committed %cd' --date=format:'%F %H:%M' "origin/$CHANNEL" 2>/dev/null || echo unknown)
    line "channel" "origin/$CHANNEL at $tip"
    line "last fetch" "$(stat -c %y "$REPO/.git/FETCH_HEAD" 2>/dev/null | cut -d. -f1 || echo never)"
fi
line "web build" "$(cat "$REPO/web/.next/BUILD_ID" 2>/dev/null || echo none) ($(stat -c %y "$REPO/web/.next/BUILD_ID" 2>/dev/null | cut -d. -f1))"
for u in conservatory-web fern conservatory-autodeploy; do
    line "$u" "$(systemctl is-active "$u" 2>/dev/null) / $(systemctl is-enabled "$u" 2>/dev/null)"
done
line ":3010 (next)" "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3010$BASE")"
if [ "$role" = station ]; then
    # Plain http on the station's one origin: Caddy on :80 routes /conservatory
    # to :3010 (the Aviary's Caddyfile.station, reclinerhead/aviary#684).
    line "http://<this box>/conservatory" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1/conservatory 2>/dev/null || echo unreachable)"
else
    # -k on purpose: this line asks whether the door answers, and the box's own
    # curl does not carry the house root certificate, so a trusted check from
    # here would read 000 forever. A phone with the root installed is the trust check.
    line "https://conservatory.lan" "$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 https://conservatory.lan/ 2>/dev/null || echo unreachable)"
fi
echo
echo "watcher, last 3 lines:"
journalctl -u conservatory-autodeploy -n 3 --no-pager -o cat 2>/dev/null | sed 's/^/    /'
echo "fern, last 5 lines:"
journalctl -u fern -n 5 --no-pager -o cat 2>/dev/null | sed 's/^/    /'
