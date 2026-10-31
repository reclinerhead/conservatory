"""Fern's loop: claim a job, send its photos to Pl@ntNet, record what came back.

`run_once` does one job and is the unit the loop repeats. It takes the clock
and the identify function as arguments so the tests can drive it without the
network. The thumbnail is written for every processed job, rejected ones
included, because the confirm screen shows the photo either way.

When the queue is idle the loop hands the tick to the enrichment pass
(`enrich.run_once`, #20) and, when that has nothing to do, to the care pass
(`care.run_once`, #23), so one unit and one journal cover all three.
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
            # The queue is idle: the enrichment pass gets the tick (#20), one
            # species at a time, so an upload never waits behind Wikipedia;
            # when it has nothing either, the care pass writes one sheet (#23).
            busy = enrich.run_once(conn, data_dir, now) or care.run_once(conn, care_cfg, zone, now)
            time.sleep(1 if busy else 2)
        elif outcome.status == "quota":
            paused_until = outcome.resume_at
            log.warning("quota spent; resuming at %s", paused_until)
        else:
            time.sleep(1)  # well under Pl@ntNet's concurrency cap, and polite
