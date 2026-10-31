"""Backoff, claiming order, and what each outcome does to a job row."""

from datetime import datetime, timedelta, timezone

from fern import db, plantnet, queue, worker

NOW = datetime(2026, 10, 31, 15, 0, tzinfo=timezone.utc)


def test_backoff_doubles_from_thirty_seconds_and_caps():
    assert [queue.backoff_seconds(n) for n in (1, 2, 3, 4, 5)] == [30, 60, 120, 240, 480]
    assert queue.backoff_seconds(12) == 30 * 60


def test_next_attempt_stops_at_max_attempts():
    assert queue.next_attempt_at(1, NOW) == NOW + timedelta(seconds=30)
    assert queue.next_attempt_at(queue.MAX_ATTEMPTS, NOW) is None


def _db(tmp_path):
    return db.connect(tmp_path / "c.db")


def _job(conn, created_at):
    cur = conn.execute("INSERT INTO jobs (created_at) VALUES (?)", (created_at,))
    conn.commit()
    return cur.lastrowid


def test_claim_takes_the_oldest_queued_job_and_marks_it_identifying(tmp_path):
    conn = _db(tmp_path)
    newer = _job(conn, "2026-10-31T14:59:00.000Z")
    older = _job(conn, "2026-10-31T14:00:00.000Z")
    row = queue.claim_next(conn, NOW)
    assert row["id"] == older and row["status"] == "identifying"
    row2 = queue.claim_next(conn, NOW)
    assert row2["id"] == newer
    assert queue.claim_next(conn, NOW) is None


def test_failed_jobs_come_back_only_after_their_backoff(tmp_path):
    conn = _db(tmp_path)
    jid = _job(conn, "2026-10-31T14:00:00.000Z")
    queue.claim_next(conn, NOW)
    queue.record_outcome(conn, jid, plantnet.Outcome("retry", error="http 503"), NOW)
    job = conn.execute("SELECT * FROM jobs WHERE id = ?", (jid,)).fetchone()
    assert job["status"] == "failed" and job["attempts"] == 1
    assert job["next_attempt_at"] == queue.iso(NOW + timedelta(seconds=30))
    assert queue.claim_next(conn, NOW + timedelta(seconds=10)) is None
    assert queue.claim_next(conn, NOW + timedelta(seconds=31))["id"] == jid


def test_out_of_tries_stays_failed(tmp_path):
    conn = _db(tmp_path)
    jid = _job(conn, "2026-10-31T14:00:00.000Z")
    when = NOW
    for _ in range(queue.MAX_ATTEMPTS):
        assert queue.claim_next(conn, when)["id"] == jid
        queue.record_outcome(conn, jid, plantnet.Outcome("retry", error="http 503"), when)
        when += timedelta(hours=1)
    job = conn.execute("SELECT * FROM jobs WHERE id = ?", (jid,)).fetchone()
    assert job["attempts"] == queue.MAX_ATTEMPTS and job["next_attempt_at"] is None
    assert job["finished_at"] is not None
    assert queue.claim_next(conn, when) is None


def test_identified_writes_candidates_and_quota(tmp_path):
    conn = _db(tmp_path)
    jid = _job(conn, "2026-10-31T14:00:00.000Z")
    queue.claim_next(conn, NOW)
    cands = [
        plantnet.Candidate("species", 1, "Ficus elastica", "Ficus", "Moraceae", 0.8, "5361903", ["Rubber Plant"]),
        plantnet.Candidate("genus", 1, "Ficus", "Ficus", "Moraceae", 0.84),
    ]
    queue.record_outcome(conn, jid, plantnet.Outcome("identified", candidates=cands, remaining=499), NOW)
    job = conn.execute("SELECT * FROM jobs WHERE id = ?", (jid,)).fetchone()
    assert job["status"] == "identified" and job["quota_remaining"] == 499 and job["error"] is None
    rows = conn.execute("SELECT kind, rank, scientific_name, common_names FROM candidates WHERE job_id = ? ORDER BY kind, rank", (jid,)).fetchall()
    assert [tuple(r) for r in rows] == [("genus", 1, "Ficus", "[]"), ("species", 1, "Ficus elastica", '["Rubber Plant"]')]


def test_quota_returns_the_job_to_the_queue_without_an_attempt(tmp_path):
    conn = _db(tmp_path)
    jid = _job(conn, "2026-10-31T14:00:00.000Z")
    queue.claim_next(conn, NOW)
    queue.record_outcome(conn, jid, plantnet.Outcome("quota", resume_at=NOW + timedelta(hours=9), error="429"), NOW)
    job = conn.execute("SELECT * FROM jobs WHERE id = ?", (jid,)).fetchone()
    assert job["status"] == "queued" and job["attempts"] == 0


def test_run_once_sends_the_photos_and_records_the_answer(tmp_path):
    conn = _db(tmp_path)
    data = tmp_path / "data"
    rel = "photos/2026/10/abc.jpg"
    src = data / rel
    src.parent.mkdir(parents=True)
    from PIL import Image

    Image.new("RGB", (1600, 1200), (40, 120, 60)).save(src, "JPEG")
    jid = _job(conn, "2026-10-31T14:00:00.000Z")
    conn.execute("INSERT INTO photos (path, organ, job_id) VALUES (?, 'leaf', ?)", (rel, jid))
    conn.commit()

    seen = {}

    def fake_identify(api_key, images):
        seen["key"] = api_key
        seen["images"] = images
        return 200, {"results": [{"score": 0.5, "species": {"scientificNameWithoutAuthor": "Ficus elastica",
                     "genus": {"scientificNameWithoutAuthor": "Ficus"}, "family": {"scientificNameWithoutAuthor": "Moraceae"}}}],
                     "remainingIdentificationRequests": 7}, {}

    out = worker.run_once(conn, data, "k", NOW, identify=fake_identify)
    assert out.status == "identified"
    assert seen["key"] == "k"
    name, blob, organ = seen["images"][0]
    assert name == "abc.jpg" and organ == "leaf"
    with Image.open(__import__("io").BytesIO(blob)) as im:
        assert max(im.size) <= plantnet.LONG_SIDE
    assert (data / worker.thumb_path(rel)).exists()
    assert conn.execute("SELECT status, quota_remaining FROM jobs WHERE id = ?", (jid,)).fetchone()[1] == 7
    assert worker.run_once(conn, data, "k", NOW, identify=fake_identify) is None
