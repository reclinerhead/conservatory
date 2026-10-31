"""The identification queue: which job runs next, and what an outcome does to it.

Rules (epic #4): one job at a time, oldest first. A transient failure backs
off exponentially for MAX_ATTEMPTS tries and then stays `failed` with its
error. A 429 is not an attempt: the job goes back to `queued` and the worker
pauses until the quota resets. Timestamps are ISO 8601 UTC text, the same
shape the schema's defaults write, so string comparison orders them.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta, timezone

from .plantnet import Candidate, Outcome

MAX_ATTEMPTS = 5
BACKOFF_BASE_S = 30
BACKOFF_CAP_S = 30 * 60


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def backoff_seconds(attempts: int) -> int:
    """30 s, 60 s, 120 s, 240 s, 480 s ... capped at 30 min. `attempts` counts the one that just failed."""
    if attempts < 1:
        return BACKOFF_BASE_S
    return min(BACKOFF_BASE_S * 2 ** (attempts - 1), BACKOFF_CAP_S)


def next_attempt_at(attempts: int, now: datetime) -> datetime | None:
    """When a job that has failed `attempts` times may run again; None once it is out of tries."""
    if attempts >= MAX_ATTEMPTS:
        return None
    return now + timedelta(seconds=backoff_seconds(attempts))


def claim_next(conn: sqlite3.Connection, now: datetime) -> sqlite3.Row | None:
    """Pick the oldest runnable job and mark it `identifying`. Returns the job row, or None."""
    now_s = iso(now)
    with conn:
        row = conn.execute(
            """
            SELECT * FROM jobs
             WHERE status = 'queued'
                OR (status = 'failed' AND attempts < ? AND next_attempt_at IS NOT NULL AND next_attempt_at <= ?)
             ORDER BY created_at, id
             LIMIT 1
            """,
            (MAX_ATTEMPTS, now_s),
        ).fetchone()
        if row is None:
            return None
        conn.execute("UPDATE jobs SET status = 'identifying', next_attempt_at = NULL WHERE id = ?", (row["id"],))
    return conn.execute("SELECT * FROM jobs WHERE id = ?", (row["id"],)).fetchone()


def job_photos(conn: sqlite3.Connection, job_id: int) -> list[sqlite3.Row]:
    return conn.execute("SELECT * FROM photos WHERE job_id = ? ORDER BY id", (job_id,)).fetchall()


def record_outcome(conn: sqlite3.Connection, job_id: int, outcome: Outcome, now: datetime) -> None:
    """Apply an outcome to the job row and its candidates."""
    now_s = iso(now)
    with conn:
        conn.execute("DELETE FROM candidates WHERE job_id = ?", (job_id,))
        if outcome.status == "identified":
            conn.executemany(
                """INSERT INTO candidates (job_id, kind, rank, scientific_name, genus, family, score, gbif_id, common_names)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                [_candidate_row(job_id, c) for c in outcome.candidates],
            )
            conn.execute(
                """UPDATE jobs SET status = 'identified', finished_at = ?, error = NULL, quota_remaining = ?,
                                   attempts = attempts + 1 WHERE id = ?""",
                (now_s, outcome.remaining, job_id),
            )
        elif outcome.status == "rejected":
            conn.execute(
                """UPDATE jobs SET status = 'rejected', finished_at = ?, error = ?, quota_remaining = COALESCE(?, quota_remaining),
                                   attempts = attempts + 1 WHERE id = ?""",
                (now_s, outcome.error, outcome.remaining, job_id),
            )
        elif outcome.status == "quota":
            # Not an attempt. Back to the queue; the worker pauses until resume_at.
            conn.execute("UPDATE jobs SET status = 'queued', error = ? WHERE id = ?", (outcome.error, job_id))
        elif outcome.status == "retry":
            attempts = int(conn.execute("SELECT attempts FROM jobs WHERE id = ?", (job_id,)).fetchone()[0]) + 1
            when = next_attempt_at(attempts, now)
            conn.execute(
                "UPDATE jobs SET status = 'failed', attempts = ?, next_attempt_at = ?, error = ?, finished_at = ? WHERE id = ?",
                (attempts, iso(when) if when else None, outcome.error, None if when else now_s, job_id),
            )
        else:  # failed, permanently
            conn.execute(
                """UPDATE jobs SET status = 'failed', attempts = ?, next_attempt_at = NULL, error = ?, finished_at = ? WHERE id = ?""",
                (MAX_ATTEMPTS, outcome.error, now_s, job_id),
            )


def _candidate_row(job_id: int, c: Candidate) -> tuple:
    return (job_id, c.kind, c.rank, c.scientific_name, c.genus, c.family, c.score, c.gbif_id, json.dumps(c.common_names))
