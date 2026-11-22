"""Fern's loop: claim a job, send its photos to Pl@ntNet, record what came back.

`run_once` does one job and is the unit the loop repeats. It takes the clock
and the identify function as arguments so the tests can drive it without the
network. The thumbnail is written for every processed job, rejected ones
included, because the confirm screen shows the photo either way, and the
launcher's copy with it (#119, `cover_path`).

When the queue is idle the loop hands the tick to a queued health check
(`health.run_once`, #87), then the thumbnail sweep (`sweep_once`, #26), then
the enrichment pass (`enrich.run_once`, #20) and, when that has nothing to
do, the care pass (`care.run_once`, #23), so one unit and one journal cover
all of them. A tick with none of that to do gives one photo already on disk
its launcher copy (`cover_once`), until every photo has been looked at once.
"""

from __future__ import annotations

import logging
import sqlite3
import time
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path

from . import care, enrich, health, llm, plantnet, queue

log = logging.getLogger("fern")

IdentifyFn = Callable[[str, list[tuple[str, bytes, str]]], tuple[int, dict, dict]]


def thumb_path(rel: str) -> str:
    """photos/2026/10/abc.jpg -> photos/2026/10/abc.thumb.jpg"""
    p = Path(rel)
    return str(p.with_name(p.stem + ".thumb.jpg")).replace("\\", "/")


def cover_path(rel: str) -> str:
    """photos/2026/10/abc.jpg -> photos/2026/10/abc.cover.jpg: the launcher's copy (#119)."""
    p = Path(rel)
    return str(p.with_name(p.stem + ".cover.jpg")).replace("\\", "/")


def run_once(
    conn: sqlite3.Connection,
    data_dir: Path,
    api_key: str,
    now: datetime | None = None,
    identify: IdentifyFn = plantnet.identify,
) -> plantnet.Outcome | None:
    """Process the next runnable job. Returns its outcome, or None when the queue is idle."""
    now = now or datetime.now(timezone.utc)
    job = queue.claim_next(conn, now)
    if job is None:
        return None

    photos = queue.job_photos(conn, job["id"])
    images: list[tuple[str, bytes, str]] = []
    for ph in photos:
        src = data_dir / ph["path"]
        try:
            images.append((Path(ph["path"]).name, plantnet.prepare_image(src), ph["organ"]))
            plantnet.write_thumbnail(src, data_dir / thumb_path(ph["path"]))
            plantnet.write_cover(src, data_dir / cover_path(ph["path"]))
        except (OSError, ValueError) as exc:
            log.warning("job %d: photo %s unreadable: %s", job["id"], ph["path"], exc)

    if not images:
        outcome = plantnet.Outcome("failed", error="no readable photos")
    else:
        status, body, headers = identify(api_key, images)
        outcome = plantnet.classify(status, body, headers, now)

    queue.record_outcome(conn, job["id"], outcome, now)
    top = next((c for c in outcome.candidates if c.kind == "species"), None)
    log.info(
        "job %d: %s%s%s%s",
        job["id"],
        outcome.status,
        f" {top.scientific_name} {top.score:.2f}" if top else "",
        f" (quota left {outcome.remaining})" if outcome.remaining is not None else "",
        f" {outcome.error}" if outcome.error else "",
    )
    return outcome


def sweep_once(conn: sqlite3.Connection, data_dir: Path, now: datetime | None = None) -> bool:
    """Write the thumbnail of one job-less photo that has none yet. Returns whether there was one.

    These are the photos added straight to a plant from its page (#26); job
    photos get theirs from run_once and are never picked. The row is stamped
    whatever happens, so an unreadable file is one line and never a stall."""
    now = now or datetime.now(timezone.utc)
    row = conn.execute(
        "SELECT id, path, specimen_id FROM photos WHERE job_id IS NULL AND thumb_at IS NULL ORDER BY id LIMIT 1"
    ).fetchone()
    if row is None:
        return False
    try:
        plantnet.write_thumbnail(data_dir / row["path"], data_dir / thumb_path(row["path"]))
        plantnet.write_cover(data_dir / row["path"], data_dir / cover_path(row["path"]))
        log.info("photo %d (specimen %s): thumbnail written", row["id"], row["specimen_id"])
    except Exception as exc:  # noqa: BLE001  (one line per unreadable photo, whatever it was)
        log.warning("photo %d (specimen %s): %s unreadable, no thumbnail: %s", row["id"], row["specimen_id"], row["path"], exc)
    with conn:
        conn.execute("UPDATE photos SET thumb_at = ? WHERE id = ?", (queue.iso(now), row["id"]))
    return True


def cover_once(conn: sqlite3.Connection, data_dir: Path, after_id: int) -> int | None:
    """Give the next photo after `after_id` its launcher copy (#119) if it has none.
    Returns that photo's id, the next call's `after_id`, or None once there are no more.

    This is for the photos that were on disk before Fern wrote covers; a new
    photo gets its own from run_once or the sweep. One photo a call, and the
    place is kept by the caller, not the database: a restart walks the table
    again, and a photo that has its copy costs one look at the directory. An
    unreadable file is one line and is passed over."""
    row = conn.execute("SELECT id, path FROM photos WHERE id > ? ORDER BY id LIMIT 1", (after_id,)).fetchone()
    if row is None:
        return None
    dst = data_dir / cover_path(row["path"])
    if not dst.exists():
        try:
            plantnet.write_cover(data_dir / row["path"], dst)
            log.info("photo %d: launcher cover written", row["id"])
        except Exception as exc:  # noqa: BLE001  (one line per unreadable photo, whatever it was)
            log.warning("photo %d: %s unreadable, no launcher cover: %s", row["id"], row["path"], exc)
    return row["id"]


def idle_tick(
    conn: sqlite3.Connection,
    data_dir: Path,
    now: datetime,
    care_cfg: llm.Config | None = None,
    zone: str | None = None,
    health_cfg: llm.Config | None = None,
) -> bool:
    """The queue is idle: one queued health check (#87), else one thumbnail
    for a photo added to a plant (#26), else one species enriched (#20), else
    one care sheet written (#23). The health check goes first because someone
    pressed a button and is waiting on the page; the sweep next because its
    photo is already on a page someone is looking at. Returns whether any of
    them had work."""
    return (
        health.run_once(conn, data_dir, health_cfg, zone, now)
        or sweep_once(conn, data_dir, now)
        or enrich.run_once(conn, data_dir, now)
        or care.run_once(conn, care_cfg, zone, now)
    )


def run_forever(
    conn: sqlite3.Connection,
    data_dir: Path,
    api_key: str,
    should_run: Callable[[], bool],
    care_cfg: llm.Config | None = None,
    zone: str | None = None,
    health_cfg: llm.Config | None = None,
) -> None:
    paused_until: datetime | None = None
    covered: int | None = 0  # the last photo cover_once looked at; None once it has walked them all
    while should_run():
        now = datetime.now(timezone.utc)
        if paused_until and now < paused_until:
            time.sleep(5)
            continue
        paused_until = None
        outcome = run_once(conn, data_dir, api_key, now)
        if outcome is None:
            # The queue is idle: one small piece of other work per tick, so an
            # upload never waits behind Wikipedia or more than one model call.
            busy = idle_tick(conn, data_dir, now, care_cfg, zone, health_cfg)
            if not busy and covered is not None:
                covered = cover_once(conn, data_dir, covered)
                busy = covered is not None
            time.sleep(1 if busy else 2)
        elif outcome.status == "quota":
            paused_until = outcome.resume_at
            log.warning("quota spent; resuming at %s", paused_until)
        else:
            time.sleep(1)  # well under Pl@ntNet's concurrency cap, and polite
