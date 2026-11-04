"""The schema applies cleanly, twice, and migration steps run once each."""

import sqlite3

from fern import db


def test_connect_creates_schema_at_latest_version(tmp_path):
    conn = db.connect(tmp_path / "nested" / "c.db")
    assert db.current_version(conn) == db.LATEST_VERSION >= db.BASELINE_VERSION
    tables = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"photos", "jobs", "candidates", "species", "specimens", "confirmations"} <= tables
    assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert db.queued_jobs(conn) == 0


def test_apply_schema_is_idempotent(tmp_path):
    conn = db.connect(tmp_path / "c.db")
    conn.execute("INSERT INTO jobs DEFAULT VALUES")
    conn.commit()
    assert db.apply_schema(conn) == db.LATEST_VERSION
    assert db.apply_schema(conn) == db.LATEST_VERSION
    assert db.queued_jobs(conn) == 1
    assert conn.execute("SELECT COUNT(*) FROM schema_version").fetchone()[0] == len(db.MIGRATIONS) + 1


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


def test_v4_adds_thumb_at_over_a_v3_database_once(tmp_path, monkeypatch):
    steps = db.MIGRATIONS
    monkeypatch.setattr(db, "MIGRATIONS", steps[:2])
    conn = db.connect(tmp_path / "c.db")
    assert db.current_version(conn) == 3
    conn.execute("INSERT INTO photos (path) VALUES ('photos/2026/10/abc.jpg')")
    conn.commit()
    monkeypatch.setattr(db, "MIGRATIONS", steps[:3])
    assert db.apply_schema(conn) == 4
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(photos)")}
    assert "thumb_at" in cols
    assert tuple(conn.execute("SELECT path, thumb_at FROM photos").fetchone()) == ("photos/2026/10/abc.jpg", None)
    # A second apply is a no-op: the ALTER would fail if it ran again.
    assert db.apply_schema(conn) == 4
    assert [r["version"] for r in conn.execute("SELECT version FROM schema_version ORDER BY version")] == [1, 2, 3, 4]


def test_job_status_is_constrained(tmp_path):
    conn = db.connect(tmp_path / "c.db")
    try:
        conn.execute("INSERT INTO jobs (status) VALUES ('bogus')")
        raise AssertionError("CHECK constraint did not fire")
    except sqlite3.IntegrityError:
        pass


def _v4_database_with_plants(path, monkeypatch):
    """A v4 database with three plants (ids 1, 2 and 5), their photos and naming records."""
    steps = db.MIGRATIONS
    monkeypatch.setattr(db, "MIGRATIONS", steps[:3])
    conn = db.connect(path)
    assert db.current_version(conn) == 4
    conn.execute("INSERT INTO species (id, scientific_name) VALUES (1, 'Ficus elastica')")
    for sid, nick in [(1, "Granddaddy"), (2, None), (5, "Shelf baby")]:
        conn.execute("INSERT INTO specimens (id, species_id, nickname, location) VALUES (?, 1, ?, 'Shelf 2')", (sid, nick))
        conn.execute("INSERT INTO jobs (id, status) VALUES (?, 'identified')", (sid,))
        conn.execute("INSERT INTO photos (path, job_id, specimen_id) VALUES (?, ?, ?)", (f"photos/2026/10/{sid}.jpg", sid, sid))
        conn.execute("INSERT INTO confirmations (job_id, specimen_id, chosen_rank) VALUES (?, ?, 1)", (sid, sid))
    conn.commit()
    monkeypatch.setattr(db, "MIGRATIONS", steps)
    return conn


def test_v5_rebuilds_specimens_keeping_every_id_and_link(tmp_path, monkeypatch):
    conn = _v4_database_with_plants(tmp_path / "c.db", monkeypatch)
    monkeypatch.setattr(db, "MIGRATIONS", db.MIGRATIONS[:4])  # up to v5
    assert db.apply_schema(conn) == 5

    assert [tuple(r) for r in conn.execute("SELECT id, nickname, location, tagged_at FROM specimens ORDER BY id")] == [
        (1, "Granddaddy", "Shelf 2", None),
        (2, None, "Shelf 2", None),
        (5, "Shelf baby", "Shelf 2", None),
    ]
    # With foreign keys on, DROP TABLE would have cascaded the confirmations
    # away and nulled the photos' links; both survive.
    assert [tuple(r) for r in conn.execute("SELECT path, specimen_id FROM photos ORDER BY id")] == [
        ("photos/2026/10/1.jpg", 1),
        ("photos/2026/10/2.jpg", 2),
        ("photos/2026/10/5.jpg", 5),
    ]
    assert [tuple(r) for r in conn.execute("SELECT job_id, specimen_id FROM confirmations ORDER BY job_id")] == [(1, 1), (2, 2), (5, 5)]

    indexes = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'specimens'")}
    assert {"specimens_location", "specimens_species"} <= indexes
    assert "AUTOINCREMENT" in conn.execute("SELECT sql FROM sqlite_master WHERE name = 'specimens'").fetchone()[0]
    assert conn.execute("SELECT seq FROM sqlite_sequence WHERE name = 'specimens'").fetchone()[0] == 5
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    # A second apply is a no-op.
    assert db.apply_schema(conn) == 5
    assert [r["version"] for r in conn.execute("SELECT version FROM schema_version ORDER BY version")] == [1, 2, 3, 4, 5]


def test_after_v5_a_removed_plants_id_is_never_reused(tmp_path, monkeypatch):
    conn = _v4_database_with_plants(tmp_path / "c.db", monkeypatch)
    db.apply_schema(conn)
    conn.execute("DELETE FROM specimens WHERE id = 5")  # the newest plant, removed
    conn.commit()
    new_id = conn.execute("INSERT INTO specimens (species_id) VALUES (1)").lastrowid
    assert new_id == 6


def test_a_rebuild_that_breaks_a_link_rolls_back_with_foreign_keys_on(tmp_path, monkeypatch):
    conn = _v4_database_with_plants(tmp_path / "c.db", monkeypatch)
    # A rebuild that forgets plant 5: its photo and confirmation would point at nothing.
    broken = db.MIGRATIONS[3][1].replace("FROM specimens;", "FROM specimens WHERE id < 5;")
    monkeypatch.setattr(db, "MIGRATIONS", [*db.MIGRATIONS[:3], (5, broken, db.FOREIGN_KEYS_OFF)])
    try:
        db.apply_schema(conn)
        raise AssertionError("foreign_key_check did not stop the step")
    except sqlite3.IntegrityError as err:
        assert "foreign_key_check" in str(err)
    assert db.current_version(conn) == 4
    assert conn.execute("SELECT COUNT(*) FROM specimens").fetchone()[0] == 3
    assert "tagged_at" not in {r["name"] for r in conn.execute("PRAGMA table_info(specimens)")}
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1


def test_v6_adds_hero_photo_id_over_a_v5_database_once(tmp_path, monkeypatch):
    conn = _v4_database_with_plants(tmp_path / "c.db", monkeypatch)
    steps = db.MIGRATIONS
    monkeypatch.setattr(db, "MIGRATIONS", steps[:4])
    assert db.apply_schema(conn) == 5
    monkeypatch.setattr(db, "MIGRATIONS", steps[:5])
    assert db.apply_schema(conn) == 6
    # Every plant keeps its rows and has no main photo chosen: newest first, as before.
    assert [tuple(r) for r in conn.execute("SELECT id, nickname, hero_photo_id FROM specimens ORDER BY id")] == [
        (1, "Granddaddy", None),
        (2, None, None),
        (5, "Shelf baby", None),
    ]
    # A second apply is a no-op: the ALTER would fail if it ran again.
    assert db.apply_schema(conn) == 6
    assert [r["version"] for r in conn.execute("SELECT version FROM schema_version ORDER BY version")] == [1, 2, 3, 4, 5, 6]


def test_v7_drops_the_nickname_keeping_every_plant(tmp_path, monkeypatch):
    # The fixture's plants carry nicknames, as a box's real rows might.
    conn = _v4_database_with_plants(tmp_path / "c.db", monkeypatch)
    steps = db.MIGRATIONS
    monkeypatch.setattr(db, "MIGRATIONS", steps[:5])
    assert db.apply_schema(conn) == 6
    photo = conn.execute("SELECT id FROM photos WHERE specimen_id = 5").fetchone()[0]
    conn.execute("UPDATE specimens SET tagged_at = '2026-10-30T12:00:00Z', hero_photo_id = ?, status = 'gifted' WHERE id = 5", (photo,))
    conn.commit()
    monkeypatch.setattr(db, "MIGRATIONS", steps)
    assert db.apply_schema(conn) == 7

    assert "nickname" not in {r["name"] for r in conn.execute("PRAGMA table_info(specimens)")}
    assert [tuple(r) for r in conn.execute("SELECT id, location, status, tagged_at, hero_photo_id FROM specimens ORDER BY id")] == [
        (1, "Shelf 2", "alive", None, None),
        (2, "Shelf 2", "alive", None, None),
        (5, "Shelf 2", "gifted", "2026-10-30T12:00:00Z", photo),
    ]
    assert [tuple(r) for r in conn.execute("SELECT job_id, specimen_id FROM confirmations ORDER BY job_id")] == [(1, 1), (2, 2), (5, 5)]
    indexes = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'specimens'")}
    assert {"specimens_location", "specimens_species"} <= indexes
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    # A second apply is a no-op: the DROP would fail if it ran again.
    assert db.apply_schema(conn) == 7
    assert [r["version"] for r in conn.execute("SELECT version FROM schema_version ORDER BY version")] == [1, 2, 3, 4, 5, 6, 7]


def test_a_fresh_database_has_no_nickname(tmp_path):
    conn = db.connect(tmp_path / "c.db")
    assert db.current_version(conn) == db.LATEST_VERSION == 7
    assert "nickname" not in {r["name"] for r in conn.execute("PRAGMA table_info(specimens)")}


def test_removing_a_plants_main_photo_puts_it_back_on_its_newest(tmp_path, monkeypatch):
    conn = _v4_database_with_plants(tmp_path / "c.db", monkeypatch)
    db.apply_schema(conn)
    photo = conn.execute("SELECT id FROM photos WHERE specimen_id = 1").fetchone()[0]
    conn.execute("UPDATE specimens SET hero_photo_id = ? WHERE id = 1", (photo,))
    conn.commit()
    conn.execute("DELETE FROM photos WHERE id = ?", (photo,))
    conn.commit()
    assert conn.execute("SELECT hero_photo_id FROM specimens WHERE id = 1").fetchone()[0] is None
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
