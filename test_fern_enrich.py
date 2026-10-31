"""The enrichment pass (#20): the GBIF and Wikipedia parsers, the worklist, the
v2 migration over a Phase 1 database, and one species end to end with the
wire replaced. HTTP itself stays untested."""

import io
from datetime import datetime, timedelta, timezone

from PIL import Image

from fern import db, enrich
from fern.queue import iso

NOW = datetime(2026, 10, 31, 15, 0, tzinfo=timezone.utc)

# Shaped on live answers, 2026-10-31.
GBIF_SPECIES = {
    "usageKey": 7835333, "scientificName": "Ficus elastica Roxb.", "canonicalName": "Ficus elastica",
    "rank": "SPECIES", "status": "ACCEPTED", "confidence": 99, "matchType": "EXACT",
    "kingdom": "Plantae", "phylum": "Tracheophyta", "order": "Rosales", "family": "Moraceae",
    "genus": "Ficus", "species": "Ficus elastica", "class": "Magnoliopsida",
}
GBIF_GENUS = {
    "usageKey": 5362052, "scientificName": "Echeveria DC.", "canonicalName": "Echeveria",
    "rank": "GENUS", "status": "ACCEPTED", "confidence": 95, "matchType": "HIGHERRANK",
    "kingdom": "Plantae", "phylum": "Tracheophyta", "order": "Saxifragales", "family": "Crassulaceae",
    "genus": "Echeveria", "class": "Magnoliopsida",
}
# What GBIF says to nonsense: the kingdom, confidently.
GBIF_KINGDOM = {"usageKey": 6, "scientificName": "Plantae", "canonicalName": "Plantae", "rank": "KINGDOM",
                "confidence": 99, "matchType": "HIGHERRANK", "kingdom": "Plantae"}
GBIF_NONE = {"confidence": 100, "matchType": "NONE", "synonym": False}

WIKI_PAGE = {"batchcomplete": True, "query": {"pages": [{
    "pageid": 1763894, "ns": 0, "title": "Ficus elastica",
    "extract": "Ficus elastica, the rubber fig, is a species of flowering plant in the family Moraceae.\n\n",
    "original": {"source": "https://upload.wikimedia.org/wikipedia/commons/1/16/Ficus_elastica_leaves_02.JPG", "width": 2304, "height": 1728},
    "pageimage": "Ficus_elastica_leaves_02.JPG",
    "fullurl": "https://en.wikipedia.org/wiki/Ficus_elastica", "canonicalurl": "https://en.wikipedia.org/wiki/Ficus_elastica",
}]}}
WIKI_NO_IMAGE = {"query": {"pages": [{"title": "Sedum blorbii", "extract": "A &amp; B.\n\n\n\nC.",
                                       "canonicalurl": "https://en.wikipedia.org/wiki/Sedum_blorbii"}]}}
WIKI_MISSING = {"query": {"pages": [{"ns": 0, "title": "Blorbus nonsensicus", "missing": True,
                                      "canonicalurl": "https://en.wikipedia.org/wiki/Blorbus_nonsensicus"}]}}
WIKI_DISAMBIG = {"query": {"pages": [{"title": "Iris", "pageprops": {"disambiguation": ""}, "extract": "Iris most often refers to:",
                                       "canonicalurl": "https://en.wikipedia.org/wiki/Iris"}]}}


# --- match_name --------------------------------------------------------------


def test_match_name_strips_a_cultivar_and_placeholders():
    assert enrich.match_name("Ficus elastica 'Ruby'") == "Ficus elastica"
    assert enrich.match_name("Echeveria ‘Black Prince’") == "Echeveria"
    assert enrich.match_name('Hosta "Sum and Substance"') == "Hosta"
    assert enrich.match_name("Echeveria cv. Perle von Nurnberg") == "Echeveria"
    assert enrich.match_name("Sedum sp.") == "Sedum"
    assert enrich.match_name("  Ficus   elastica ") == "Ficus elastica"
    assert enrich.match_name("Ficus elastica") == "Ficus elastica"


# --- parse_match -------------------------------------------------------------


def test_parse_match_accepts_a_species():
    t = enrich.parse_match(GBIF_SPECIES)
    assert t is not None
    assert (t.gbif_key, t.rank, t.canonical_name, t.authorship) == (7835333, "species", "Ficus elastica", "Roxb.")
    assert (t.kingdom, t.phylum, t.class_, t.order, t.family, t.genus) == (
        "Plantae", "Tracheophyta", "Magnoliopsida", "Rosales", "Moraceae", "Ficus")


def test_parse_match_accepts_a_genus_only_match():
    t = enrich.parse_match(GBIF_GENUS)
    assert t is not None
    assert (t.rank, t.genus, t.family, t.authorship) == ("genus", "Echeveria", "Crassulaceae", "DC.")


def test_parse_match_rejects_misses():
    assert enrich.parse_match(GBIF_KINGDOM) is None  # a higher rank than genus, however confident
    assert enrich.parse_match(GBIF_NONE) is None
    assert enrich.parse_match({**GBIF_SPECIES, "confidence": 79}) is None
    assert enrich.parse_match({**GBIF_SPECIES, "confidence": 80}) is not None
    assert enrich.parse_match(None) is None
    assert enrich.parse_match({}) is None


def test_parse_vernacular_takes_the_first_english_name():
    body = {"results": [{"vernacularName": "Gummibaum", "language": "deu"},
                        {"vernacularName": "Rubber Plant", "language": "eng"},
                        {"vernacularName": "Rubber Fig", "language": "eng"}]}
    assert enrich.parse_vernacular(body) == "Rubber Plant"
    assert enrich.parse_vernacular({"results": []}) is None
    assert enrich.parse_vernacular(None) is None


# --- parse_page --------------------------------------------------------------


def test_parse_page_with_summary_and_image():
    p = enrich.parse_page(WIKI_PAGE)
    assert p is not None
    assert p.title == "Ficus elastica" and p.url == "https://en.wikipedia.org/wiki/Ficus_elastica"
    assert p.summary == "Ficus elastica, the rubber fig, is a species of flowering plant in the family Moraceae."
    assert p.image_url.endswith("Ficus_elastica_leaves_02.JPG")
    assert (p.image_width, p.image_height) == (2304, 1728)
    assert p.credit == "Ficus elastica · Wikipedia"
    assert p.image_source_url == "https://commons.wikimedia.org/wiki/File:Ficus_elastica_leaves_02.JPG"


def test_parse_page_without_an_image_cleans_the_extract():
    p = enrich.parse_page(WIKI_NO_IMAGE)
    assert p is not None
    assert p.summary == "A & B.\n\nC."
    assert p.image_url is None and p.image_name is None and p.image_source_url is None


def test_parse_page_skips_a_vector_page_image():
    body = {"query": {"pages": [{**WIKI_PAGE["query"]["pages"][0], "pageimage": "Range_map.svg",
                                  "original": {"source": "https://upload.wikimedia.org/x/Range_map.svg"}}]}}
    p = enrich.parse_page(body)
    assert p is not None and p.summary and p.image_url is None


def test_parse_page_treats_missing_and_disambiguation_as_no_page():
    assert enrich.parse_page(WIKI_MISSING) is None
    assert enrich.parse_page(WIKI_DISAMBIG) is None
    assert enrich.parse_page(None) is None
    assert enrich.parse_page({"query": {"pages": []}}) is None
    assert enrich.is_disambiguation(WIKI_DISAMBIG) is True
    assert enrich.is_disambiguation(WIKI_MISSING) is False and enrich.is_disambiguation(WIKI_PAGE) is False


# --- the migration -----------------------------------------------------------


def _v1_database(tmp_path, monkeypatch):
    """A Phase 1 database with its rows, as a box that has not deployed v2 holds it."""
    monkeypatch.setattr(db, "MIGRATIONS", [])
    conn = db.connect(tmp_path / "c.db")
    assert db.current_version(conn) == 1
    conn.execute("INSERT INTO species (scientific_name, genus, family, gbif_id) VALUES ('Ficus elastica', 'Ficus', 'Moraceae', '5361850')")
    conn.execute("INSERT INTO species (scientific_name, cultivar) VALUES ('Echeveria', 'Black Prince')")
    conn.execute("INSERT INTO specimens (species_id, nickname) VALUES (1, 'Rubber')")
    conn.commit()
    monkeypatch.undo()
    return conn


def test_v2_migrates_a_phase_1_database_with_its_rows_intact(tmp_path, monkeypatch):
    conn = _v1_database(tmp_path, monkeypatch)
    assert db.apply_schema(conn) == db.LATEST_VERSION
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(species)")}
    assert {"gbif_key", "rank", "kingdom", "phylum", "class", "order_", "canonical_name", "authorship", "common_name",
            "summary", "summary_url", "image_path", "image_credit", "image_source_url", "enriched_at", "enrich_error"} <= cols
    rows = conn.execute("SELECT scientific_name, genus, cultivar, enriched_at FROM species ORDER BY id").fetchall()
    assert [tuple(r) for r in rows] == [("Ficus elastica", "Ficus", None, None), ("Echeveria", None, "Black Prince", None)]
    assert conn.execute("SELECT nickname FROM specimens WHERE species_id = 1").fetchone()[0] == "Rubber"
    assert db.apply_schema(conn) == db.LATEST_VERSION  # idempotent: the ALTERs do not run twice


def test_a_fresh_database_comes_up_at_the_latest_version(tmp_path):
    conn = db.connect(tmp_path / "c.db")
    assert db.current_version(conn) == db.LATEST_VERSION >= 2


# --- the worklist ------------------------------------------------------------


def _species(conn, name, created_at, enriched_at=None, error=None):
    cur = conn.execute(
        "INSERT INTO species (scientific_name, created_at, enriched_at, enrich_error) VALUES (?, ?, ?, ?)",
        (name, created_at, enriched_at, error),
    )
    conn.commit()
    return cur.lastrowid


def test_worklist_unenriched_first_then_stale_errors_never_the_done(tmp_path):
    conn = db.connect(tmp_path / "c.db")
    done = _species(conn, "Done", "2026-10-01T00:00:00.000Z", iso(NOW - timedelta(days=30)))
    fresh_err = _species(conn, "Fresh error", "2026-10-02T00:00:00.000Z", iso(NOW - timedelta(hours=23)), "GBIF: no match")
    stale_err = _species(conn, "Stale error", "2026-10-03T00:00:00.000Z", iso(NOW - timedelta(days=1, minutes=1)), "GBIF: no match")
    newer = _species(conn, "Newer", "2026-10-31T14:59:00.000Z")
    older = _species(conn, "Older", "2026-10-30T00:00:00.000Z")
    ids = [r["id"] for r in enrich.worklist(conn, NOW, limit=10)]
    assert ids == [older, newer, stale_err]
    assert done not in ids and fresh_err not in ids
    assert enrich.worklist(conn, NOW)[0]["id"] == older
    # A day later the fresh error is due too.
    assert [r["id"] for r in enrich.worklist(conn, NOW + timedelta(hours=2), limit=10)] == [older, newer, fresh_err, stale_err]


# --- one species, end to end, with the wire replaced -------------------------


def _png_bytes(w=1600, h=1200):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (60, 110, 70)).save(buf, "PNG")
    return buf.getvalue()


def _fake_wire(answers, fetched):
    """fetch_json answers by host; fetch_bytes hands back a PNG and remembers the URL."""

    def fetch_json(url, params):
        fetched.append((url, dict(params)))
        if url == enrich.GBIF_MATCH_URL:
            return answers["match"]
        if url.startswith(enrich.GBIF_SPECIES_URL):
            return answers.get("vernacular", {"results": []})
        if url == enrich.WIKIPEDIA_API:
            return answers["page"]
        raise AssertionError(url)

    def fetch_bytes(url):
        fetched.append(("bytes", url))
        return _png_bytes()

    return fetch_json, fetch_bytes


def test_enrich_species_fills_the_row_and_writes_the_reference_image(tmp_path):
    conn = db.connect(tmp_path / "c.db")
    data = tmp_path / "data"
    sid = _species(conn, "Ficus elastica 'Ruby'", "2026-10-30T00:00:00.000Z")
    fetched = []
    answers = {"match": GBIF_SPECIES, "page": WIKI_PAGE,
               "vernacular": {"results": [{"vernacularName": "Rubber Plant", "language": "eng"}]}}
    line = enrich.enrich_species(conn, data, sid, NOW, *_fake_wire(answers, fetched))

    assert line == "enriched Ficus elastica 'Ruby': GBIF 7835333 (Moraceae), Wikipedia summary 87 chars, image 1280x960"
    assert fetched[0][1]["name"] == "Ficus elastica"  # the cultivar never goes to GBIF
    assert fetched[2][1]["titles"] == "Ficus elastica" and fetched[2][1]["redirects"] == 1
    row = conn.execute("SELECT * FROM species WHERE id = ?", (sid,)).fetchone()
    assert row["scientific_name"] == "Ficus elastica 'Ruby'"  # the confirmed name is never rewritten
    assert (row["gbif_key"], row["rank"], row["genus"], row["family"], row["order_"], row["class"]) == (
        7835333, "species", "Ficus", "Moraceae", "Rosales", "Magnoliopsida")
    assert (row["canonical_name"], row["authorship"], row["common_name"]) == ("Ficus elastica", "Roxb.", "Rubber Plant")
    assert row["summary"].startswith("Ficus elastica, the rubber fig") and row["summary_url"].endswith("/Ficus_elastica")
    assert row["image_path"] == f"reference/{sid}.jpg"
    assert row["image_credit"] == "Ficus elastica · Wikipedia"
    assert row["image_source_url"] == "https://commons.wikimedia.org/wiki/File:Ficus_elastica_leaves_02.JPG"
    assert row["enriched_at"] == iso(NOW) and row["enrich_error"] is None
    with Image.open(data / "reference" / f"{sid}.jpg") as im:
        assert im.size == (1280, 960) and im.format == "JPEG"
    with Image.open(data / "reference" / f"{sid}.thumb.jpg") as im:
        assert max(im.size) == 320
    assert not (data / "photos").exists()  # nothing under photos/ is touched
    assert enrich.worklist(conn, NOW) == []


def test_a_name_gbif_cannot_match_is_stamped_with_the_error_and_still_asks_wikipedia(tmp_path):
    conn = db.connect(tmp_path / "c.db")
    sid = _species(conn, "Blorbus nonsensicus", "2026-10-30T00:00:00.000Z")
    fetched = []
    line = enrich.enrich_species(conn, tmp_path / "data", sid, NOW, *_fake_wire({"match": GBIF_KINGDOM, "page": WIKI_MISSING}, fetched))
    assert line == "enriched Blorbus nonsensicus: GBIF no match, Wikipedia no page"
    row = conn.execute("SELECT * FROM species WHERE id = ?", (sid,)).fetchone()
    assert row["enriched_at"] == iso(NOW) and row["enrich_error"] == "GBIF: no match for 'Blorbus nonsensicus'"
    assert row["gbif_key"] is None and row["summary"] is None and row["image_path"] is None
    assert [u for u, _p in fetched] == [enrich.GBIF_MATCH_URL, enrich.WIKIPEDIA_API]  # no vernacular call, no download
    assert enrich.worklist(conn, NOW) == []
    assert [r["id"] for r in enrich.worklist(conn, NOW + enrich.RETRY_AFTER)] == [sid]


def test_a_genus_row_looks_up_the_genus_page_and_a_404_is_not_an_error(tmp_path):
    conn = db.connect(tmp_path / "c.db")
    sid = _species(conn, "Echeveria", "2026-10-30T00:00:00.000Z")
    fetched = []
    line = enrich.enrich_species(conn, tmp_path / "data", sid, NOW, *_fake_wire({"match": GBIF_GENUS, "page": WIKI_MISSING}, fetched))
    assert line == "enriched Echeveria: GBIF 5362052 (Crassulaceae), Wikipedia no page"
    assert fetched[-1][1]["titles"] == "Echeveria"
    row = conn.execute("SELECT * FROM species WHERE id = ?", (sid,)).fetchone()
    assert (row["rank"], row["genus"], row["family"], row["enrich_error"]) == ("genus", "Echeveria", "Crassulaceae", None)
    assert row["enriched_at"] == iso(NOW) and row["summary"] is None


def test_a_disambiguation_page_is_retried_as_the_plant_article(tmp_path):
    conn = db.connect(tmp_path / "c.db")
    sid = _species(conn, "Iris", "2026-10-30T00:00:00.000Z")
    gbif_iris = {**GBIF_GENUS, "usageKey": 2748017, "scientificName": "Iris L.", "canonicalName": "Iris", "family": "Iridaceae", "genus": "Iris"}
    iris_plant = {"query": {"pages": [{"title": "Iris (plant)", "extract": "Iris is a genus of flowering plants.",
                                        "canonicalurl": "https://en.wikipedia.org/wiki/Iris_(plant)"}]}}
    asked = []

    def fetch_json(url, params):
        if url == enrich.GBIF_MATCH_URL:
            return gbif_iris
        if url.startswith(enrich.GBIF_SPECIES_URL):
            return {"results": []}
        asked.append(params["titles"])
        return WIKI_DISAMBIG if params["titles"] == "Iris" else iris_plant

    line = enrich.enrich_species(conn, tmp_path / "data", sid, NOW, fetch_json, lambda url: b"")
    assert asked == ["Iris", "Iris (plant)"]
    assert line == "enriched Iris: GBIF 2748017 (Iridaceae), Wikipedia summary 36 chars, no image"
    row = conn.execute("SELECT summary, summary_url, image_credit FROM species WHERE id = ?", (sid,)).fetchone()
    assert row["summary_url"] == "https://en.wikipedia.org/wiki/Iris_(plant)" and row["image_credit"] is None


def test_run_once_logs_one_loud_line_on_failure_and_does_not_loop(tmp_path, caplog):
    conn = db.connect(tmp_path / "c.db")
    sid = _species(conn, "Ficus elastica", "2026-10-30T00:00:00.000Z")

    def broken(url, params):
        raise ConnectionError("dns is having a day")

    with caplog.at_level("ERROR", logger="fern"):
        assert enrich.run_once(conn, tmp_path / "data", NOW, fetch_json=broken) is True
    assert "FAILED" in caplog.text and "dns is having a day" in caplog.text
    row = conn.execute("SELECT enriched_at, enrich_error FROM species WHERE id = ?", (sid,)).fetchone()
    assert row["enriched_at"] == iso(NOW) and row["enrich_error"].startswith("ConnectionError: dns")
    # Nothing to do until the retry window passes: no dead loop.
    assert enrich.run_once(conn, tmp_path / "data", NOW + timedelta(seconds=1), fetch_json=broken) is False
    assert enrich.run_once(conn, tmp_path / "data", NOW + enrich.RETRY_AFTER, fetch_json=broken) is True


def test_run_once_is_idle_with_nothing_to_do(tmp_path):
    conn = db.connect(tmp_path / "c.db")
    assert enrich.run_once(conn, tmp_path / "data", NOW) is False
