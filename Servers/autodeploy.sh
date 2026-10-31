#!/usr/bin/env bash
# =============================================================================
# The Conservatory -- Servers/autodeploy.sh (issue #9)
#
# The deploy watcher: a long-lived loop that checks origin/main every
# CONSERVATORY_DEPLOY_INTERVAL_S and brings this box current when it moves.
# Merging a PR IS the deploy; nobody SSHes anywhere. It is the Aviary's
# autodeploy.sh pattern, one copy per repo (the Aviary's #627 D10), cut
# down to what this app has: one Python worker and one Next app.
#
# What a tick does when origin/main moved past HEAD:
#   pull --ff-only (never force; a dirty or diverged checkout is skipped
#   loudly, never clobbered), then
#   - fern/ changed            -> pip install if requirements.txt changed,
#                                 then restart fern
#   - web/ changed             -> pnpm install + pnpm build, and restart
#                                 conservatory-web only if the build passed
#                                 (a failed build never restarts: old code
#                                 keeps serving; the journal says fix forward)
#   - Servers/autodeploy.sh    -> hand over to the new copy
#   Anything else (docs, tests, the spike) costs nothing.
#
# Pull-based over anonymous https: the repo is public, so no key of any kind
# lives on the box. If the repo is ever made private, the fetch fails and
# this loop logs one line and retries quietly forever (the Aviary's lesson
# of 2026-07-27): a visibility change is a fleet event.
#
# A loop service, not a timer: quiet ticks log nothing, so
# `journalctl -u conservatory-autodeploy` reads as a deploy history and
# silence is the healthy state.
#
# Runs as root (the point: restarting units needs no sudo password), but
# every git, pip and pnpm step is demoted to the checkout owner with setpriv
# (no PAM session per call), so nothing in ~/conservatory, .venv/ or .next/
# ever becomes root-owned. --reset-env gives the demoted step the owner's
# HOME, so `bash -l` finds the profile where nvm's node and pnpm live.
#
# Config (env on the unit):
#   CONSERVATORY_REPO               checkout path, default /home/todd/conservatory
#   CONSERVATORY_DEPLOY_USER        checkout owner, default todd
#   CONSERVATORY_DEPLOY_INTERVAL_S  poll cadence, default 60
#
# Hand runs: `autodeploy.sh --once` is a single tick, no loop. The sanctioned
# way to pin the box on unmerged work is to check out a branch: the branch
# guard pauses deploys while the checkout is off main and resumes them the
# moment it is back.
#
# Deliberately NOT `set -e`: the loop must survive a failed fetch, build or
# restart; every step checks and logs its own failure, and the next tick
# retries.
# =============================================================================

set -uo pipefail

REPO="${CONSERVATORY_REPO:-/home/todd/conservatory}"
SELF="$REPO/Servers/autodeploy.sh"
OWNER="${CONSERVATORY_DEPLOY_USER:-todd}"
INTERVAL="${CONSERVATORY_DEPLOY_INTERVAL_S:-60}"
BRANCH=main

fetch_down=0
off_branch=0
self_changed=0

log() { echo "[autodeploy] $*"; }

as_owner() {
    setpriv --reuid="$OWNER" --regid="$OWNER" --init-groups --reset-env "$@"
}

repo_git() { as_owner git -C "$REPO" "$@"; }

restart_unit() {
    if systemctl restart "$1"; then
        log "restarted $1"
    else
        log "restart FAILED for $1 -- check: systemctl status $1"
    fi
}

# Fern: a fresh requirements.txt means a pip install first; then restart.
deploy_fern() {
    local changed="$1"
    if grep -q "^fern/requirements.txt$" <<<"$changed"; then
        log "fern/requirements.txt changed -- installing"
        local out
        if ! out=$(as_owner bash -lc "cd '$REPO' && .venv/bin/pip install -q -r fern/requirements.txt" 2>&1); then
            log "pip install FAILED -- fern keeps its old packages; fix forward"
            printf '%s\n' "$out" | tail -n 20
        fi
    fi
    restart_unit fern
}

# The web app: install -> build -> restart, the deploy-web.sh order. Built as
# the owner through a login shell so pnpm is on PATH and .next/ stays theirs.
deploy_web() {
    log "web/ changed -- install + build, then restart (the deploy-web.sh order)"
    local out
    if out=$(as_owner bash -lc "cd '$REPO/web' && pnpm install --frozen-lockfile && pnpm build" 2>&1); then
        restart_unit conservatory-web
    else
        log "web build FAILED -- old build keeps serving; fix forward and merge again"
        printf '%s\n' "$out" | tail -n 30
    fi
}

tick() {
    self_changed=0

    local branch
    branch=$(repo_git rev-parse --abbrev-ref HEAD) || return 0
    if [ "$branch" != "$BRANCH" ]; then
        if [ "$off_branch" -eq 0 ]; then
            off_branch=1
            log "checkout is on '$branch', not $BRANCH -- deploys paused until it returns"
        fi
        return 0
    fi
    if [ "$off_branch" -eq 1 ]; then
        off_branch=0
        log "back on $BRANCH -- deploys resume"
    fi

    if ! repo_git fetch --quiet origin "$BRANCH"; then
        if [ "$fetch_down" -eq 0 ]; then
            fetch_down=1
            log "can't fetch origin (network/GitHub down?) -- retrying quietly"
        fi
        return 0
    fi
    if [ "$fetch_down" -eq 1 ]; then
        fetch_down=0
        log "fetch recovered"
    fi

    local head remote
    head=$(repo_git rev-parse HEAD) || return 0
    remote=$(repo_git rev-parse "origin/$BRANCH") || return 0
    [ "$head" = "$remote" ] && return 0

    # Only TRACKED changes make a checkout dirty: .venv/, web/.next/ and
    # node_modules/ are ignored and a --ff-only pull cannot harm them.
    if [ -n "$(repo_git status --porcelain --untracked-files=no)" ]; then
        log "origin/$BRANCH moved to ${remote:0:9} but the checkout is dirty -- not touching it"
        return 0
    fi

    log "deploying ${head:0:9} -> ${remote:0:9} from origin/$BRANCH"
    if ! repo_git pull --ff-only --quiet; then
        log "pull --ff-only refused (diverged history?) -- needs a human"
        return 0
    fi

    local changed
    changed=$(repo_git diff --name-only "$head" "$remote")

    if grep -q "^fern/" <<<"$changed"; then deploy_fern "$changed"; fi
    if grep -q "^web/" <<<"$changed"; then deploy_web; fi
    if grep -q "^Servers/autodeploy.sh$" <<<"$changed"; then self_changed=1; fi
    log "deploy complete at ${remote:0:9}"
}

main() {
    if [ "${1:-}" = "--once" ]; then
        tick
        return
    fi
    log "watching origin/$BRANCH every ${INTERVAL}s -- repo: $REPO" \
        "branch: $(repo_git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
    while true; do
        tick
        if [ "$self_changed" -eq 1 ]; then
            log "autodeploy.sh itself changed -- handing over to the new copy"
            exec "$SELF"
        fi
        sleep "$INTERVAL"
    done
}

main "$@"
