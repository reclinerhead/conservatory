#!/usr/bin/env bash
# check.sh -- is the Conservatory healthy on this box? No sudo. Reads the
# units, the port, the door, the watcher's last line and Fern's last jobs.
#
#     bash ~/conservatory/Servers/check.sh

REPO="${CONSERVATORY_REPO:-$HOME/conservatory}"

line() { printf '%-22s %s\n' "$1" "$2"; }

echo "The Conservatory on $(hostname), $(date '+%F %H:%M')"
line "checkout" "$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null) on $(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null) ($(git -C "$REPO" status --porcelain --untracked-files=no 2>/dev/null | wc -l) tracked changes)"
line "web build" "$(cat "$REPO/web/.next/BUILD_ID" 2>/dev/null || echo none) ($(stat -c %y "$REPO/web/.next/BUILD_ID" 2>/dev/null | cut -d. -f1))"
for u in conservatory-web fern conservatory-autodeploy; do
    line "$u" "$(systemctl is-active "$u" 2>/dev/null) / $(systemctl is-enabled "$u" 2>/dev/null)"
done
line ":3010 (next)" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3010/)"
# -k on purpose: this line asks whether the door answers, and the box's own
# curl does not carry the house root certificate, so a trusted check from
# here would read 000 forever. A phone with the root installed is the trust check.
line "https://conservatory.lan" "$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 https://conservatory.lan/ 2>/dev/null || echo unreachable)"
echo
echo "watcher, last 3 lines:"
journalctl -u conservatory-autodeploy -n 3 --no-pager -o cat 2>/dev/null | sed 's/^/    /'
echo "fern, last 5 lines:"
journalctl -u fern -n 5 --no-pager -o cat 2>/dev/null | sed 's/^/    /'
