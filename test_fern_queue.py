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


# --- the thumbnail sweep (#26): photos added straight to a plant --------------


def _plant(conn):
    conn.execute("INSERT INTO species (scientific_name) VALUES ('Ficus elastica')")
    cur = conn.execute("INSERT INTO specimens (species_id) VALUES (1)")
    conn.commit()
    return cur.lastrowid


def _photo_file(data, rel, size=(1600, 1200)):
    from PIL import Image

    src = data / rel
    src.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, (40, 120, 60)).save(src, "JPEG")


def _added_photo(conn, rel, specimen_id, thumb_at=None):
    cur = conn.execute("INSERT INTO photos (path, specimen_id, thumb_at) VALUES (?, ?, ?)", (rel, specimen_id, thumb_at))
    conn.commit()
    return cur.lastrowid


def test_sweep_writes_the_thumbnail_of_a_photo_added_to_a_plant(tmp_path):
    conn = _db(tmp_path)
    data = tmp_path / "data"
    rel = "photos/2026/10/added.jpg"
    _photo_file(data, rel)
    pid = _added_photo(conn, rel, _plant(conn))

    assert worker.sweep_once(conn, data, NOW) is True
    from PIL import Image

    with Image.open(data / worker.thumb_path(rel)) as im:
        assert max(im.size) == plantnet.THUMB_SIDE
    assert conn.execute("SELECT thumb_at FROM photos WHERE id = ?", (pid,)).fetchone()[0] == queue.iso(NOW)
    assert worker.sweep_once(conn, data, NOW) is False  # stamped, so never picked again


def test_sweep_leaves_job_photos_and_stamped_photos_alone(tmp_path):
    conn = _db(tmp_path)
    data = tmp_path / "data"
    sid = _plant(conn)
    job_rel, stamped_rel = "photos/2026/10/job.jpg", "photos/2026/10/stamped.jpg"
    _photo_file(data, job_rel)
    _photo_file(data, stamped_rel)
    jid = _job(conn, "2026-10-31T14:00:00.000Z")
    conn.execute("INSERT INTO photos (path, job_id, specimen_id) VALUES (?, ?, ?)", (job_rel, jid, sid))
    conn.commit()
    _added_photo(conn, stamped_rel, sid, thumb_at="2026-10-31T14:30:00.000Z")

    assert worker.sweep_once(conn, data, NOW) is False
    assert not (data / worker.thumb_path(job_rel)).exists()
    assert not (data / worker.thumb_path(stamped_rel)).exists()
    assert conn.execute("SELECT thumb_at FROM photos WHERE job_id = ?", (jid,)).fetchone()[0] is None


def test_sweep_stamps_an_unreadable_photo_and_moves_on(tmp_path, caplog):
    conn = _db(tmp_path)
    data = tmp_path / "data"
    sid = _plant(conn)
    bad_rel, good_rel = "photos/2026/10/bad.jpg", "photos/2026/10/good.jpg"
    (data / bad_rel).parent.mkdir(parents=True)
    (data / bad_rel).write_bytes(b"not a picture")
    _photo_file(data, good_rel)
    bad = _added_photo(conn, bad_rel, sid)
    _added_photo(conn, good_rel, sid)

    with caplog.at_level("WARNING", logger="fern"):
        assert worker.sweep_once(conn, data, NOW) is True
    assert f"photo {bad} (specimen {sid}): {bad_rel} unreadable" in caplog.text
    assert conn.execute("SELECT thumb_at FROM photos WHERE id = ?", (bad,)).fetchone()[0] == queue.iso(NOW)
    assert not (data / worker.thumb_path(bad_rel)).exists()
    assert worker.sweep_once(conn, data, NOW) is True  # the next tick takes the good one, not the bad one again
    assert (data / worker.thumb_path(good_rel)).exists()
    assert worker.sweep_once(conn, data, NOW) is False


def test_idle_tick_sweeps_first_then_hands_the_tick_to_enrichment(tmp_path, monkeypatch):
    from fern import care, enrich

    conn = _db(tmp_path)
    data = tmp_path / "data"
    rel = "photos/2026/10/added.jpg"
    _photo_file(data, rel)
    _added_photo(conn, rel, _plant(conn))
    calls = []
    monkeypatch.setattr(enrich, "run_once", lambda *a, **k: calls.append("enrich") or True)
    monkeypatch.setattr(care, "run_once", lambda *a, **k: calls.append("care") or True)

    assert worker.idle_tick(conn, data, NOW) is True
    assert calls == []  # the thumbnail had the tick
    assert (data / worker.thumb_path(rel)).exists()
    assert worker.idle_tick(conn, data, NOW) is True
    assert calls == ["enrich"]  # nothing left to sweep: enrichment's turn, and it had work
