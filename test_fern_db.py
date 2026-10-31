"""The schema applies cleanly, twice, and migration steps run once each."""

import sqlite3

from fern import db


def test_connect_creates_schema_at_baseline(tmp_path):
    conn = db.connect(tmp_path / "nested" / "c.db")
    assert db.current_version(conn) == db.BASELINE_VERSION
    tables = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"photos", "jobs", "candidates", "species", "specimens", "confirmations"} <= tables
    assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert db.queued_jobs(conn) == 0


def test_apply_schema_is_idempotent(tmp_path):
    conn = db.connect(tmp_path / "c.db")
    conn.execute("INSERT INTO jobs DEFAULT VALUES")
    conn.commit()
    assert db.apply_schema(conn) == db.BASELINE_VERSION
    assert db.apply_schema(conn) == db.BASELINE_VERSION
    assert db.queued_jobs(conn) == 1
    assert conn.execute("SELECT COUNT(*) FROM schema_version").fetchone()[0] == 1


def test_migration_steps_run_once_in_order(tmp_path, monkeypatch):
    monkeypatch.setattr(
        db,
        "MIGRATIONS",
        [
            (2, "ALTER TABLE specimens ADD COLUMN parent_specimen_id INTEGER REFERENCES specimens(id)"),
            (3, "CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY)"),
        ],
    )
    conn = db.connect(tmp_path / "c.db")
    assert db.current_version(conn) == 3
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(specimens)")}
    assert "parent_specimen_id" in cols
    # A second apply is a no-op: the ALTER would fail if it ran again.
    assert db.apply_schema(conn) == 3
    assert [r["version"] for r in conn.execute("SELECT version FROM schema_version ORDER BY version")] == [1, 2, 3]


def test_job_status_is_constrained(tmp_path):
    conn = db.connect(tmp_path / "c.db")
    try:
        conn.execute("INSERT INTO jobs (status) VALUES ('bogus')")
        raise AssertionError("CHECK constraint did not fire")
    except sqlite3.IntegrityError:
        pass
