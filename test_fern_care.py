"""The care pass (#23): the answer validator, the worklist, the prompt
assembly, the v3 migration over a v2 database, and one sheet end to end with
the model faked. The gateway itself is never called here; its reply parser is."""

import json
import logging
from datetime import datetime, timedelta, timezone

import pytest

from fern import care, db, llm
from fern.queue import iso

NOW = datetime(2026, 10, 31, 15, 0, tzinfo=timezone.utc)
CFG = llm.Config(key="test-key", model="anthropic/claude-sonnet-5.5")


def _cell(headline="Bright, indirect light", text="Keep it near a window that gets morning sun. Too little light and it drops its lower leaves.", figures=None):
    return {"headline": headline, "text": text, "figures": figures if figures is not None else [
        {"label": "light", "value": "4–6 hours bright, indirect", "basis": "an understorey tree of monsoon forest"}]}


def _answer(**overrides):
    body = {k: _cell() for k in care.CELL_KEYS}
    body.update(overrides)
    return json.dumps(body)


# --- the validator -----------------------------------------------------------


def test_parse_answer_keeps_the_six_cells_cleaned_and_in_order():
    cells = care.parse_answer(_answer(extra=_cell()))
    assert list(cells) == list(care.CELL_KEYS)  # the mockup's six, the stray key dropped
    assert cells["water"]["figures"][0] == {"label": "light", "value": "4–6 hours bright, indirect", "basis": "an understorey tree of monsoon forest"}


def test_parse_answer_forgives_a_code_fence_and_a_sentence_around_the_object():
    text = "Here is the sheet:\n```json\n" + _answer() + "\n```"
    assert set(care.parse_answer(text)) == set(care.CELL_KEYS)


def test_parse_answer_allows_a_cell_with_nothing_to_measure():
    cells = care.parse_answer(_answer(dormancy=_cell("No real rest", "It grows all year indoors. Water a little less in the darkest months.", [])))
    assert cells["dormancy"]["figures"] == []


@pytest.mark.parametrize(
    "answer, words",
    [
        (json.dumps({k: _cell() for k in care.CELL_KEYS if k != "soil"}), "missing soil"),
        (_answer(water=_cell(text="Water it.")), "water: text is too short"),
        (_answer(light=_cell(headline="")), "light: headline is too short"),
        (_answer(soil=_cell(figures=[{"label": "repot every", "value": "2–3 years"}])), "soil: figure 1 basis is not text"),
        (_answer(soil=_cell(figures=[{"label": "pH", "value": "6–7", "basis": "   "}])), "soil: figure 1 basis is too short"),
        (_answer(hardiness="Zones 10–12"), "hardiness: not an object"),
        ("I cannot help with that.", "no JSON object"),
        ('{"light": ', "no JSON object"),
        ("{" + _answer()[1:-1] + ",}", "not valid JSON"),
    ],
)
def test_parse_answer_rejects_what_it_will_not_store(answer, words):
    with pytest.raises(care.InvalidAnswer, match=words):
        care.parse_answer(answer)


# --- the prompt --------------------------------------------------------------


def test_the_prompt_file_has_a_version_and_names_the_six_cells():
    version, system = care.load_prompt()
    assert version >= 1
    for k in care.CELL_KEYS:
        assert f"`{k}`" in system


def _row(**over):
    row = {"id": 1, "scientific_name": "Ficus elastica", "canonical_name": "Ficus elastica", "cultivar": "Ruby", "rank": "species",
           "common_name": "India Rubber Fig", "kingdom": "Plantae", "phylum": "Tracheophyta", "class": "Magnoliopsida",
           "order_": "Rosales", "family": "Moraceae", "genus": "Ficus",
           "summary": "Ficus elastica, the rubber fig, is a species of flowering plant. It is native to eastern parts of South Asia. It has broad shiny oval leaves.",
           "summary_url": "https://en.wikipedia.org/wiki/Ficus_elastica"}
    row.update(over)
    return row


def test_build_prompt_names_the_zone_the_ranks_and_the_opening_of_the_article():
    prompt, notes = care.build_prompt(_row(), "6a")
    assert "Write the care sheet for: Ficus elastica" in prompt
    assert "Level: species." in prompt
    assert "Household hardiness zone: USDA 6a" in prompt
    assert "order Rosales, family Moraceae, genus Ficus" in prompt
    assert "Cultivar on the nursery tag: 'Ruby'" in prompt
    assert "native to eastern parts of South Asia." in prompt and "broad shiny" not in prompt  # two sentences, not the article
    assert notes["zone"] == "6a" and notes["level"] == "species" and notes["taxonomy"]["order"] == "Rosales"


def test_build_prompt_falls_back_to_the_genus_for_a_genus_row_and_a_hybrid():
    prompt, notes = care.build_prompt(_row(scientific_name="Echeveria", canonical_name="Echeveria", rank="genus", genus="Echeveria",
                                           family="Crassulaceae", cultivar="Black Prince", common_name=None), "6a")
    assert "Write the care sheet for: Echeveria" in prompt
    assert "Level: genus. The household's plant is named only to the genus" in prompt
    assert notes["subject"] == "Echeveria" and notes["level"] == "genus"
    hybrid = _row(scientific_name="Echeveria × imbricata", canonical_name="Echeveria imbricata", genus="Echeveria")
    assert care.care_level(hybrid) == "genus" and care.subject(hybrid, "genus") == "Echeveria"
    assert care.care_level(_row(scientific_name="Sedum x rubrotinctum")) == "genus"
    assert care.care_level(_row()) == "species"


def test_build_prompt_without_a_zone_says_so():
    prompt, notes = care.build_prompt(_row(summary=None), None)
    assert "Household hardiness zone: not set" in prompt and "Wikipedia" not in prompt
    assert notes["zone"] is None


@pytest.mark.parametrize("raw, zone", [("6a", "6a"), (" 10B ", "10b"), ("zone 7", "7"), ("USDA Zone 5b", "5b"), ("", None), (None, None), ("14", None), ("6c", None), ("cold", None)])
def test_parse_zone(raw, zone):
    assert care.parse_zone(raw) == zone


# --- the migration -----------------------------------------------------------


def test_v3_migrates_a_v2_database_and_cascades_with_the_species(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "MIGRATIONS", db.MIGRATIONS[:1])
    conn = db.connect(tmp_path / "c.db")
    assert db.current_version(conn) == 2
    conn.execute("INSERT INTO species (scientific_name, gbif_key, enriched_at) VALUES ('Ficus elastica', 7835333, ?)", (iso(NOW),))
    conn.commit()
    monkeypatch.undo()
    assert db.apply_schema(conn) == db.LATEST_VERSION >= 3
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(care_sheets)")}
    assert cols == {"species_id", "zone", "model", "prompt_version", "cells", "notes", "written_at", "tried_at", "error"}
    assert conn.execute("SELECT gbif_key FROM species").fetchone()[0] == 7835333
    conn.execute("INSERT INTO care_sheets (species_id, prompt_version, tried_at) VALUES (1, 1, ?)", (iso(NOW),))
    conn.execute("DELETE FROM species WHERE id = 1")  # the web app does this when the last specimen goes
    assert conn.execute("SELECT COUNT(*) FROM care_sheets").fetchone()[0] == 0
    assert db.apply_schema(conn) == db.LATEST_VERSION


# --- the worklist ------------------------------------------------------------


def _species(conn, name, created_at, gbif_key=1):
    cur = conn.execute("INSERT INTO species (scientific_name, gbif_key, created_at) VALUES (?, ?, ?)", (name, gbif_key, created_at))
    conn.commit()
    return cur.lastrowid


def _sheet(conn, sid, version=1, zone="6a", tried=NOW, error=None, cells="{}"):
    conn.execute("INSERT INTO care_sheets (species_id, zone, model, prompt_version, cells, tried_at, written_at, error) VALUES (?, ?, 'm', ?, ?, ?, ?, ?)",
                 (sid, zone, version, cells, iso(tried), iso(tried), error))
    conn.commit()


def test_worklist_needs_taxonomy_and_skips_current_sheets(tmp_path):
    conn = db.connect(tmp_path / "c.db")
    unplaced = _species(conn, "Blorbus nonsensicus", "2026-10-01T00:00:00.000Z", gbif_key=None)
    current = _species(conn, "Current", "2026-10-02T00:00:00.000Z")
    _sheet(conn, current)
    newer = _species(conn, "Newer", "2026-10-30T00:00:00.000Z")
    older = _species(conn, "Older", "2026-10-03T00:00:00.000Z")
    ids = [r["id"] for r in care.worklist(conn, NOW, 1, "6a", limit=10)]
    assert ids == [older, newer]
    assert unplaced not in ids and current not in ids


def test_worklist_picks_up_an_older_prompt_version_and_a_new_zone_after_the_new_species(tmp_path):
    conn = db.connect(tmp_path / "c.db")
    old_prompt = _species(conn, "Old prompt", "2026-10-01T00:00:00.000Z")
    _sheet(conn, old_prompt, version=1)
    other_zone = _species(conn, "Other zone", "2026-10-02T00:00:00.000Z")
    _sheet(conn, other_zone, version=2, zone="5b")
    no_zone = _species(conn, "No zone", "2026-10-03T00:00:00.000Z")
    _sheet(conn, no_zone, version=2, zone=None)
    fresh = _species(conn, "Fresh", "2026-10-30T00:00:00.000Z")
    assert [r["id"] for r in care.worklist(conn, NOW, 2, "6a", limit=10)] == [fresh, old_prompt, other_zone, no_zone]
    # Unset zone, current prompt: the sheet written without a zone is current.
    assert [r["id"] for r in care.worklist(conn, NOW, 2, None, limit=10)] == [fresh, old_prompt, other_zone]


def test_worklist_retries_a_failure_only_after_a_day_whatever_its_version(tmp_path):
    conn = db.connect(tmp_path / "c.db")
    failed = _species(conn, "Failed", "2026-10-01T00:00:00.000Z")
    _sheet(conn, failed, version=1, tried=NOW - timedelta(hours=23), error="InvalidAnswer: missing soil", cells=None)
    assert care.worklist(conn, NOW, 2, "6a", limit=10) == []
    assert [r["id"] for r in care.worklist(conn, NOW + timedelta(hours=2), 2, "6a", limit=10)] == [failed]


# --- one sheet, end to end, with the model faked -----------------------------


def _placed(conn):
    conn.execute(
        """INSERT INTO species (scientific_name, cultivar, gbif_key, rank, canonical_name, common_name, kingdom, family, genus, summary, enriched_at)
           VALUES ('Ficus elastica', 'Ruby', 7835333, 'species', 'Ficus elastica', 'India Rubber Fig', 'Plantae', 'Moraceae', 'Ficus',
                   'Ficus elastica, the rubber fig, is a species of flowering plant.', ?)""",
        (iso(NOW),),
    )
    conn.commit()
    return conn.execute("SELECT last_insert_rowid()").fetchone()[0]


def _fake(answer, calls):
    def complete(cfg, system, prompt):
        calls.append((cfg.model, system, prompt))
        return llm.Reply(text=answer, input_tokens=812, output_tokens=1400)

    return complete


def test_run_once_writes_the_sheet_and_logs_one_line_with_token_usage(tmp_path, caplog):
    conn = db.connect(tmp_path / "c.db")
    sid = _placed(conn)
    calls = []
    with caplog.at_level(logging.INFO, logger="fern"):
        assert care.run_once(conn, CFG, "6a", NOW, _fake(_answer(), calls)) is True
    assert len(calls) == 1 and "USDA 6a" in calls[0][2] and "`hardiness`" in calls[0][1]
    row = conn.execute("SELECT * FROM care_sheets WHERE species_id = ?", (sid,)).fetchone()
    assert (row["zone"], row["model"], row["error"], row["written_at"]) == ("6a", CFG.model, None, iso(NOW))
    assert row["prompt_version"] == care.load_prompt()[0]
    assert list(json.loads(row["cells"])) == list(care.CELL_KEYS)
    assert json.loads(row["notes"])["subject"] == "Ficus elastica"
    lines = [r.getMessage() for r in caplog.records]
    assert lines == ["care sheet Ficus elastica (species 1): species-level for Ficus elastica, zone 6a, 6 figures, by anthropic/claude-sonnet-5.5, 812 tokens in, 1400 out"]
    # Written: off the list, and the next tick has nothing to do.
    assert care.run_once(conn, CFG, "6a", NOW, _fake(_answer(), calls)) is False and len(calls) == 1


def test_run_once_does_nothing_without_a_model(tmp_path):
    conn = db.connect(tmp_path / "c.db")
    _placed(conn)

    def explode(*_):
        raise AssertionError("the model must not be called")

    assert care.run_once(conn, None, "6a", NOW, explode) is False


def test_an_invalid_answer_is_one_loud_line_and_a_stamped_row_and_an_old_sheet_survives(tmp_path, caplog):
    conn = db.connect(tmp_path / "c.db")
    sid = _placed(conn)
    _sheet(conn, sid, version=0, cells='{"light": "old"}', tried=NOW - timedelta(days=30))
    with caplog.at_level(logging.INFO, logger="fern"):
        assert care.run_once(conn, CFG, "6a", NOW, _fake(_answer(water=_cell(text="Water it.")), [])) is True
    assert [r.levelname for r in caplog.records] == ["ERROR"]
    assert "care sheet Ficus elastica (species 1) FAILED: InvalidAnswer: water: text is too short" in caplog.records[0].getMessage()
    row = conn.execute("SELECT * FROM care_sheets WHERE species_id = ?", (sid,)).fetchone()
    assert row["cells"] == '{"light": "old"}' and row["prompt_version"] == 0  # the old sheet keeps serving
    assert row["error"].startswith("InvalidAnswer") and row["tried_at"] == iso(NOW)
    # And no loop: the next tick leaves it alone.
    assert care.run_once(conn, CFG, "6a", NOW, _fake(_answer(), [])) is False


def test_a_failed_call_stamps_a_new_row_without_cells(tmp_path):
    conn = db.connect(tmp_path / "c.db")
    sid = _placed(conn)

    def down(*_):
        raise llm.LlmError("the gateway has no credits to bill (402)")

    assert care.run_once(conn, CFG, "6a", NOW, down) is True
    row = conn.execute("SELECT * FROM care_sheets WHERE species_id = ?", (sid,)).fetchone()
    assert row["cells"] is None and row["written_at"] is None
    assert row["error"] == "LlmError: the gateway has no credits to bill (402)"


# --- the gateway's reply -----------------------------------------------------


def test_llm_parse_reply_joins_text_and_refuses_cutoffs_and_refusals():
    r = llm.parse_reply({"stop_reason": "end_turn", "usage": {"input_tokens": 5, "output_tokens": 7},
                         "content": [{"type": "thinking", "thinking": ""}, {"type": "text", "text": "{\"a\": "}, {"type": "text", "text": "1}"}]})
    assert (r.text, r.input_tokens, r.output_tokens) == ('{"a": 1}', 5, 7)
    for body, words in [({"stop_reason": "max_tokens", "content": [{"type": "text", "text": "{"}]}, "cut off"),
                        ({"stop_reason": "refusal", "content": []}, "declined"),
                        ({"stop_reason": "end_turn", "content": []}, "without text"),
                        ("nope", "not a message")]:
        with pytest.raises(llm.LlmError, match=words):
            llm.parse_reply(body)


def test_llm_config_and_payload():
    assert llm.config({}) is None and llm.config({"AI_GATEWAY_API_KEY": "  "}) is None
    assert llm.config({"AI_GATEWAY_API_KEY": "k"}) == llm.Config("k", llm.DEFAULT_MODEL)
    assert llm.config({"AI_GATEWAY_API_KEY": "k", "CONSERVATORY_LLM": "anthropic/claude-opus-5.5"}).model == "anthropic/claude-opus-5.5"
    body = llm.payload("sys", "facts", "anthropic/claude-sonnet-5.5")
    assert set(body) == {"model", "max_tokens", "system", "messages"}  # no sampling, no thinking settings
    assert body["messages"] == [{"role": "user", "content": "facts"}]
