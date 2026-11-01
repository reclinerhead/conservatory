"""Fern's loop: claim a job, send its photos to Pl@ntNet, record what came back.

`run_once` does one job and is the unit the loop repeats. It takes the clock
and the identify function as arguments so the tests can drive it without the
network. The thumbnail is written for every processed job, rejected ones
included, because the confirm screen shows the photo either way.

When the queue is idle the loop hands the tick to the thumbnail sweep
(`sweep_once`, #26), then the enrichment pass (`enrich.run_once`, #20) and,
when that has nothing to do, the care pass (`care.run_once`, #23), so one
unit and one journal cover all of them.
"""

from __future__ import annotations

import logging
import sqlite3
import time
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path

from . import care, enrich, llm, plantnet, queue

log = logging.getLogger("fern")

IdentifyFn = Callable[[str, list[tuple[str, bytes, str]]], tuple[int, dict, dict]]


def thumb_path(rel: str) -> str:
    """photos/2026/10/abc.jpg -> photos/2026/10/abc.thumb.jpg"""
    p = Path(rel)
    return str(p.with_name(p.stem + ".thumb.jpg")).replace("\\", "/")


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
        log.info("photo %d (specimen %s): thumbnail written", row["id"], row["specimen_id"])
    except Exception as exc:  # noqa: BLE001  (one line per unreadable photo, whatever it was)
        log.warning("photo %d (specimen %s): %s unreadable, no thumbnail: %s", row["id"], row["specimen_id"], row["path"], exc)
    with conn:
        conn.execute("UPDATE photos SET thumb_at = ? WHERE id = ?", (queue.iso(now), row["id"]))
    return True


def idle_tick(
    conn: sqlite3.Connection,
    data_dir: Path,
    now: datetime,
    care_cfg: llm.Config | None = None,
    zone: str | None = None,
) -> bool:
    """The queue is idle: one thumbnail for a photo added to a plant (#26), else
    one species enriched (#20), else one care sheet written (#23). The sweep
    goes first because its photo is already on a page someone is looking at.
    Returns whether any of them had work."""
    return (
        sweep_once(conn, data_dir, now)
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
) -> None:
    paused_until: datetime | None = None
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
            busy = idle_tick(conn, data_dir, now, care_cfg, zone)
            time.sleep(1 if busy else 2)
        elif outcome.status == "quota":
            paused_until = outcome.resume_at
            log.warning("quota spent; resuming at %s", paused_until)
        else:
            time.sleep(1)  # well under Pl@ntNet's concurrency cap, and polite
