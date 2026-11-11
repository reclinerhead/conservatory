"""The health check (#87): the answer validator, the prompt assembly, the
worklist, a check end to end with the model faked, the v10 migration over a
v9 database, and what llm.payload sends with photos and an effort. The
gateway itself is never called here."""

import base64
import json
import logging
from datetime import date, datetime, timedelta, timezone

import pytest

from fern import care, db, health, llm, worker
from fern.queue import iso

NOW = datetime(2026, 11, 11, 15, 0, tzinfo=timezone.utc)
TODAY = date(2026, 11, 11)
CFG = llm.Config(key="test-key", model="anthropic/claude-sonnet-5.5")
QUESTION = "White fuzzy insects are nibbling the leaves, like in the photo. What are they and how do I get rid of them?"
REPLY = "Those are mealybugs, and photo 1 shows a cluster in the leaf joint. Wipe them off with a cotton bud dipped in rubbing alcohol, then check again weekly."


def _finding(**over):
    f = {
        "seen": "White cottony tufts in the joints of the lower leaves.",
        "photo": 1,
        "likelihood": "likely",
        "remedy": "These are mealybugs. Dab each tuft with rubbing alcohol on a cotton bud and repeat every 5–7 days for three weeks.",
    }
    f.update(over)
    return {k: v for k, v in f.items() if v is not ...}  # `key=...` leaves the key out


def _answer(**over):
    body = {
        "status": "needs_attention",
        "summary": "Mealybugs on the lower leaves; treat this week and keep it apart from other plants.",
        "findings": [_finding()],
        "confidence": {"level": "medium", "why": "The tufts are distinctive but only one photo shows them close up."},
        "next_photos": ["the underside of a lower leaf"],
    }
    body.update(over)
    return json.dumps({k: v for k, v in body.items() if v is not ...})  # `key=...` leaves the key out


# --- the validator -----------------------------------------------------------


def test_parse_answer_keeps_a_clean_answer_and_drops_stray_keys():
    a = health.parse_answer(_answer(extra="ignored"), asked=False)
    assert list(a) == ["status", "summary", "findings", "confidence", "next_photos"]  # no reply, no stray key
    assert a["status"] == "needs_attention"
    assert a["findings"] == [_finding()]
    assert a["confidence"] == {"level": "medium", "why": "The tufts are distinctive but only one photo shows them close up."}
    assert a["next_photos"] == ["the underside of a lower leaf"]


def test_parse_answer_forgives_a_code_fence_and_a_sentence_around_the_object():
    text = "Here is my reading:\n```json\n" + _answer() + "\n```\nHope that helps."
    assert health.parse_answer(text, asked=False)["status"] == "needs_attention"


def test_parse_answer_takes_a_healthy_plant_with_nothing_to_note():
    a = health.parse_answer(_answer(status="healthy", summary="Looks well: firm leaves and new growth.", findings=[], next_photos=[]), asked=False)
    assert a["findings"] == [] and a["next_photos"] == []


def test_parse_answer_keeps_the_reply_when_a_question_was_asked():
    a = health.parse_answer(_answer(reply="  " + REPLY + "\n"), asked=True)
    assert a["reply"] == REPLY  # whitespace collapsed


@pytest.mark.parametrize(
    "answer, words",
    [
        (_answer(status="dying"), "status is 'dying'"),
        (_answer(status=...), "status is None"),
        (_answer(summary=...), "there is no summary"),
        (_answer(summary="   "), "there is no summary"),
        ("I cannot help with that.", "no JSON object"),
        ("{" + _answer()[1:-1] + ",}", "not valid JSON"),
    ],
)
def test_parse_answer_rejects_only_what_leaves_nothing_to_show(answer, words):
    with pytest.raises(health.InvalidAnswer, match=words):
        health.parse_answer(answer, asked=False)


def _adjusted(asked=False, **over):
    notes = []
    return health.parse_answer(_answer(**over), asked=asked, notes=notes), notes


def test_a_clean_answer_is_adjusted_in_nothing():
    assert _adjusted()[1] == [] and _adjusted(asked=True, reply=REPLY)[1] == []


def test_a_status_is_read_however_it_is_spelled_but_never_guessed():
    for spelled in ("Needs attention", "needs-attention", " NEEDS_ATTENTION "):
        assert _adjusted(status=spelled) == (health.parse_answer(_answer(), asked=False), [])


def test_a_long_summary_is_clipped_at_a_word_not_thrown_away():
    long = "The lower leaves are yellowing and soft " * 6  # 240 characters
    a, notes = _adjusted(summary=long)
    assert len(a["summary"]) <= health.MAX_SUMMARY and a["summary"].endswith("…") and not a["summary"].endswith(" …")
    assert long.startswith(a["summary"][:-1])
    assert notes == ["summary clipped from 239 characters"]


def test_long_text_is_cut_after_its_last_full_sentence_when_that_keeps_enough():
    remedy = ("Water only when the top inch of soil is dry. " * 20).strip()  # 899 characters
    a, notes = _adjusted(findings=[_finding(remedy=remedy)])
    assert len(a["findings"][0]["remedy"]) <= 700 and a["findings"][0]["remedy"].endswith("soil is dry.")
    assert notes == ["finding 1 remedy clipped from 899 characters"]


def test_findings_beyond_four_are_dropped_and_a_broken_one_does_not_cost_the_rest():
    a, notes = _adjusted(findings=[_finding(seen=f"Spot {n}.") for n in range(1, 7)])
    assert [f["seen"] for f in a["findings"]] == ["Spot 1.", "Spot 2.", "Spot 3.", "Spot 4."]  # the most important first
    assert notes == ["finding 5 dropped (more than 4)", "finding 6 dropped (more than 4)"]
    a, notes = _adjusted(findings=[_finding(remedy=...), "nope", _finding(seen="  "), _finding(remedy="Water it.")])
    assert [f["remedy"] for f in a["findings"]] == ["Water it."]  # a short remedy is still a remedy
    assert notes == ["finding 1 dropped (no remedy)", "finding 2 dropped (not an object)", "finding 3 dropped (nothing seen)"]
    assert _adjusted(findings="none") == ({**health.parse_answer(_answer(), asked=False), "findings": []}, ["findings was not a list"])


def test_an_unknown_likelihood_is_the_weaker_claim():
    a, notes = _adjusted(findings=[_finding(likelihood="certain"), _finding(likelihood="Likely")])
    assert [f["likelihood"] for f in a["findings"]] == ["possible", "likely"]
    assert notes == ["finding 1 likelihood 'certain' read as possible"]


def test_a_confidence_with_no_usable_level_is_none_not_a_guess():
    for conf in ("high", {"level": "sure", "why": "It is clear."}, ...):
        a, notes = _adjusted(confidence=conf)
        assert a["confidence"] is None and notes == ["no usable confidence"]
    a, notes = _adjusted(confidence={"level": "High"})
    assert a["confidence"] == {"level": "high", "why": ""} and notes == []


def test_next_photos_beyond_three_are_dropped_with_anything_that_is_not_text():
    a, notes = _adjusted(next_photos=["a", 7, "b", " ", "c", "d", "e"])
    assert a["next_photos"] == ["a", "b", "c"] and notes == ["2 next photos dropped (more than 3)"]
    assert _adjusted(next_photos="the soil")[0]["next_photos"] == []


def test_a_missing_reply_keeps_the_check_and_an_unasked_one_is_dropped():
    a, notes = _adjusted(asked=True)
    assert "reply" not in a and a["findings"] and notes == ["no reply to the owner's question"]
    a, notes = _adjusted(asked=False, reply=REPLY)
    assert "reply" not in a and notes == ["a reply to no question dropped"]


def test_a_summary_a_little_over_the_prompts_140_characters_is_kept():
    # The first live checks failed on summaries of 144 and 156 characters: a
    # model cannot count characters, and the answer was otherwise good.
    assert health.SUMMARY_TARGET == 140 < health.MAX_SUMMARY
    for n in (140, 144, 156, health.MAX_SUMMARY):
        assert len(health.parse_answer(_answer(summary="x" * n), asked=False)["summary"]) == n
    assert f"{health.SUMMARY_TARGET} characters" in care.load_prompt(health.PROMPT_PATH)[1]


@pytest.mark.parametrize(
    "given, count, photo",
    [(1, 2, 1), (2, 2, 2), ("1", 2, 1), (" 2 ", 2, 2), ("Photo 2", 2, 2), ("photo 1", 3, 1), (1.0, 2, 1),
     (None, 2, None), (3, 2, None), (0, 2, None), ("3", 2, None), ("1 and 2", 2, None), ("the first", 2, None),
     (1.5, 2, None), (True, 2, None), ([1], 2, None), (2, 1, None)],
)
def test_a_findings_photo_is_read_leniently_and_never_fails_the_check(given, count, photo):
    # Live, a check with two photos came back with "1" as text and was thrown away.
    assert health.photo_number(given, count) == photo
    answer = health.parse_answer(_answer(findings=[_finding(photo=given)]), asked=False, photo_count=count)
    assert answer["findings"][0]["photo"] == photo and answer["findings"][0]["seen"]  # the finding itself is kept


# --- the prompt --------------------------------------------------------------


def test_the_prompt_file_has_a_version_and_names_every_key():
    version, system = care.load_prompt(health.PROMPT_PATH)
    assert version >= 1
    for k in ("status", "summary", "reply", "findings", "confidence", "next_photos", *health.STATUSES, *health.LIKELIHOODS):
        assert f"`{k}`" in system


def _plant(**over):
    row = {"id": 3, "scientific_name": "Ficus elastica", "cultivar": "Ruby", "common_name": "India Rubber Fig", "location": "Shelf 2",
           "acquired_on": "2024-08-01", "created_at": "2026-10-28T12:00:00.000Z", "care_cells": None}
    row.update(over)
    return row


def test_build_prompt_gives_time_in_care_from_the_acquired_date():
    p = health.build_prompt(_plant(), 2, None, None, "6a", TODAY)
    assert "from the 2 photos above" in p
    assert "Species: Ficus elastica 'Ruby'" in p and "Common name: India Rubber Fig" in p
    assert "Where it is kept: Shelf 2" in p
    assert "In the household's care: about 2 years and 3 months (acquired Aug 1, 2024)" in p
    assert "Today: Nov 11, 2026" in p and "Household hardiness zone: USDA 6a" in p
    assert " old" not in p  # time in care, never an age


def test_build_prompt_without_an_acquired_date_says_at_least_since_it_was_added():
    p = health.build_prompt(_plant(acquired_on=None, location=None), 1, None, None, "6a", TODAY)
    assert "from the 1 photo above" in p
    assert "In the household's care: at least 2 weeks (added to the app Oct 28, 2026; when it was acquired is not recorded)" in p
    assert "Where it is kept: not recorded" in p


@pytest.mark.parametrize(
    "start, words",
    [("2026-11-11", "0 days"), ("2026-11-10", "1 day"), ("2026-10-01", "5 weeks"), ("2026-09-10", "2 months"),
     ("2025-11-11", "12 months"), ("2024-11-11", "2 years"), ("2023-10-11", "3 years and 1 month")],
)
def test_time_in_care_spans(start, words):
    assert health.time_in_care(start, None, TODAY) == f"about {words} (acquired {health._day_words(date.fromisoformat(start))})"


def test_time_in_care_ignores_a_date_in_the_future_or_no_date():
    assert health.time_in_care("2027-01-01", "2026-11-01T00:00:00.000Z", TODAY).startswith("at least 10 days")
    assert health.time_in_care(None, None, TODAY) == "not recorded"


def test_build_prompt_carries_the_care_sheets_headlines_or_says_there_is_none():
    cells = json.dumps({"light": {"headline": "Bright, indirect light", "text": "…"}, "water": {"headline": "Every 7–10 days"}, "soil": "odd"})
    p = health.build_prompt(_plant(care_cells=cells), 1, None, None, "6a", TODAY)
    assert "Its care sheet, in headlines: light: Bright, indirect light; water: Every 7–10 days" in p
    for none in (None, "not json", "[]"):
        assert "Its care sheet: not written yet." in health.build_prompt(_plant(care_cells=none), 1, None, None, "6a", TODAY)


def test_build_prompt_marks_the_owners_question_as_theirs_and_asks_for_a_reply():
    p = health.build_prompt(_plant(), 1, "  " + QUESTION + "\n", None, "6a", TODAY)
    assert f"<<<\n{QUESTION}\n>>>" in p
    assert "The owner asks (their words" in p and "Answer it directly in `reply`" in p
    assert "If the photos do not show what they describe, say so." in p


def test_build_prompt_without_a_question_asks_for_a_general_reading():
    for q in (None, "", "   "):
        p = health.build_prompt(_plant(), 1, q, None, "6a", TODAY)
        assert "The owner asked no question" in p and "leave `reply` out" in p and "<<<" not in p


def test_build_prompt_gives_the_previous_check_with_its_date():
    prev = {"status": "watch", "summary": "A few yellow lower leaves.", "finished_at": "2026-10-20T09:00:00.000Z"}
    p = health.build_prompt(_plant(), 1, None, prev, "6a", TODAY)
    assert "The previous health check, on Oct 20, 2026, read: watch. A few yellow lower leaves." in p
    assert "better, worse or the same" in p
    assert "Previous health check: none." in health.build_prompt(_plant(), 1, None, None, "6a", TODAY)


def test_build_prompt_without_a_zone_says_so():
    assert "Household hardiness zone: not set" in health.build_prompt(_plant(), 1, None, None, None, TODAY)


def test_build_prompt_says_where_it_grows_and_its_light_only_when_the_owner_did():
    said = health.build_prompt(_plant(), 1, None, None, "6a", TODAY, "outdoors", "natural")
    assert "The owner says it grows: outdoors" in said and "The owner says its light is: natural light" in said
    basement = health.build_prompt(_plant(), 1, None, None, "6a", TODAY, "indoors", "artificial")
    assert "The owner says it grows: indoors" in basement and "The owner says its light is: artificial light (grow lights" in basement
    # One without the other.
    only_light = health.build_prompt(_plant(), 1, None, None, "6a", TODAY, None, "artificial")
    assert "its light is: artificial" in only_light and "it grows:" not in only_light
    only_setting = health.build_prompt(_plant(), 1, None, None, "6a", TODAY, "indoors", None)
    assert "it grows: indoors" in only_setting and "its light is" not in only_setting
    # Left blank, or a value the app never writes: no line, so a blank is never a claim.
    for setting, light in ((None, None), ("", ""), ("greenhouse", "sunny")):
        p = health.build_prompt(_plant(), 1, None, None, "6a", TODAY, setting, light)
        assert "The owner says" not in p
    assert health.build_prompt(_plant(), 1, None, None, "6a", TODAY) == health.build_prompt(_plant(), 1, None, None, "6a", TODAY, None, None)


def test_the_prompt_file_says_how_to_use_the_setting_and_the_light():
    _, system = care.load_prompt(health.PROMPT_PATH)
    for words in ("indoors or outdoors", "natural or artificial", "do not assume it"):
        assert words in system


def test_photo_caption_uses_the_taken_date_else_the_upload():
    assert health.photo_caption(1, {"taken_at": "2026-10-31T10:00:00", "uploaded_at": "2026-11-03T08:00:00.000Z"}) == "Photo 1, taken Oct 31, 2026:"
    assert health.photo_caption(2, {"taken_at": None, "uploaded_at": "2026-11-03T08:00:00.000Z"}) == "Photo 2, uploaded Nov 3, 2026 (the date it was taken is not known):"


def test_media_type_by_the_first_bytes():
    assert health.media_type(b"\xff\xd8\xff\xe0rest") == "image/jpeg"
    assert health.media_type(b"\x89PNG\r\n\x1a\nrest") == "image/png"
    assert health.media_type(b"RIFF\x00\x00\x00\x00WEBPVP8 ") == "image/webp"
    assert health.media_type(b"\x00\x00\x00\x18ftypheic") is None and health.media_type(b"") is None


# --- the migration -----------------------------------------------------------


def test_v10_adds_health_checks_over_a_v9_database_and_cascades_with_the_plant(tmp_path, monkeypatch):
    steps = db.MIGRATIONS
    monkeypatch.setattr(db, "MIGRATIONS", [s for s in steps if s[0] <= 9])
    conn = db.connect(tmp_path / "c.db")
    assert db.current_version(conn) == 9
    conn.execute("INSERT INTO species (id, scientific_name) VALUES (1, 'Ficus elastica')")
    conn.execute("INSERT INTO specimens (id, species_id, location) VALUES (3, 1, 'Shelf 2')")
    conn.execute("INSERT INTO photos (id, path, specimen_id) VALUES (7, 'photos/2026/11/a.jpg', 3)")
    conn.commit()
    monkeypatch.setattr(db, "MIGRATIONS", steps)
    assert db.apply_schema(conn) == db.LATEST_VERSION >= 10
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(health_checks)")}
    assert cols == {"id", "specimen_id", "state", "photo_ids", "question", "status", "summary", "answer", "model", "prompt_version",
                    "input_tokens", "output_tokens", "error", "created_at", "finished_at", "setting", "light"}  # the last two are v11
    # What was there is untouched.
    assert tuple(conn.execute("SELECT id, location FROM specimens").fetchone()) == (3, "Shelf 2")
    assert conn.execute("SELECT specimen_id FROM photos WHERE id = 7").fetchone()[0] == 3
    # A row as the web app inserts it comes up queued, and the state is constrained.
    conn.execute("INSERT INTO health_checks (specimen_id, photo_ids) VALUES (3, '[7]')")
    assert conn.execute("SELECT state, created_at IS NOT NULL FROM health_checks").fetchone()[:] == ("queued", 1)
    with pytest.raises(Exception, match="CHECK"):
        conn.execute("UPDATE health_checks SET state = 'pending'")
    # Removing a photo leaves the checks that used it; removing the plant takes them.
    conn.execute("DELETE FROM photos WHERE id = 7")
    assert conn.execute("SELECT COUNT(*) FROM health_checks").fetchone()[0] == 1
    conn.execute("DELETE FROM specimens WHERE id = 3")
    assert conn.execute("SELECT COUNT(*) FROM health_checks").fetchone()[0] == 0
    # A second apply is a no-op: the CREATE would fail if it ran again.
    assert db.apply_schema(conn) == db.LATEST_VERSION


def test_v11_adds_the_setting_and_the_light_over_a_v10_database_and_keeps_its_checks(tmp_path, monkeypatch):
    steps = db.MIGRATIONS
    monkeypatch.setattr(db, "MIGRATIONS", [s for s in steps if s[0] <= 10])
    conn = db.connect(tmp_path / "c.db")
    assert db.current_version(conn) == 10
    conn.execute("INSERT INTO species (id, scientific_name) VALUES (1, 'Ficus elastica')")
    conn.execute("INSERT INTO specimens (id, species_id) VALUES (3, 1)")
    conn.execute("INSERT INTO health_checks (specimen_id, photo_ids, question) VALUES (3, '[7]', 'Why is it pale?')")
    conn.commit()
    monkeypatch.setattr(db, "MIGRATIONS", steps)
    assert db.apply_schema(conn) == db.LATEST_VERSION >= 11
    # A check made before v11 said neither.
    assert tuple(conn.execute("SELECT question, setting, light FROM health_checks").fetchone()) == ("Why is it pale?", None, None)
    conn.execute("INSERT INTO health_checks (specimen_id, photo_ids, setting, light) VALUES (3, '[7]', 'outdoors', 'natural')")
    conn.execute("INSERT INTO health_checks (specimen_id, photo_ids, light) VALUES (3, '[7]', 'artificial')")
    for column, value in (("setting", "garden"), ("light", "sunny")):
        with pytest.raises(Exception, match="CHECK"):
            conn.execute(f"INSERT INTO health_checks (specimen_id, photo_ids, {column}) VALUES (3, '[7]', ?)", (value,))
    assert db.apply_schema(conn) == db.LATEST_VERSION  # a second apply is a no-op


# --- the worklist and one check, with the model faked --------------------------


def _collection(tmp_path, photos=2, care_sheet=True):
    """A database with one plant (specimen 1) and its photos on disk. Returns (conn, data_dir, photo ids)."""
    from PIL import Image

    conn = db.connect(tmp_path / "c.db")
    data = tmp_path / "data"
    conn.execute("INSERT INTO species (id, scientific_name, common_name, gbif_key) VALUES (1, 'Ficus elastica', 'India Rubber Fig', 7835333)")
    conn.execute("INSERT INTO specimens (id, species_id, location, acquired_on, created_at) VALUES (1, 1, 'Shelf 2', '2024-08-01', '2026-10-28T12:00:00.000Z')")
    if care_sheet:
        conn.execute("INSERT INTO care_sheets (species_id, prompt_version, cells, tried_at) VALUES (1, 1, ?, ?)",
                     (json.dumps({"light": {"headline": "Bright, indirect light"}}), iso(NOW)))
    ids = []
    for n in range(photos):
        rel = f"photos/2026/11/p{n}.jpg"
        (data / rel).parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (64, 48), (40, 120, 60)).save(data / rel, "JPEG")
        ids.append(conn.execute("INSERT INTO photos (path, specimen_id, taken_at, uploaded_at) VALUES (?, 1, ?, '2026-11-10T08:00:00.000Z')",
                                (rel, "2026-11-09T10:00:00" if n == 0 else None)).lastrowid)
    conn.commit()
    return conn, data, ids


def _queue(conn, photo_ids, question=None, specimen=1):
    cur = conn.execute("INSERT INTO health_checks (specimen_id, photo_ids, question) VALUES (?, ?, ?)", (specimen, json.dumps(photo_ids), question))
    conn.commit()
    return cur.lastrowid


def _fake(answer, calls):
    def complete(cfg, system, prompt, images=None, effort=None):
        calls.append({"model": cfg.model, "system": system, "prompt": prompt, "images": images, "effort": effort})
        return llm.Reply(text=answer, input_tokens=5810, output_tokens=2950)

    return complete


def _explode(*_a, **_k):
    raise AssertionError("the model must not be called")


def test_worklist_is_the_oldest_queued_check_one_at_a_time(tmp_path):
    conn, _, ids = _collection(tmp_path)
    done = _queue(conn, ids)
    conn.execute("UPDATE health_checks SET state = 'done' WHERE id = ?", (done,))
    first, second = _queue(conn, ids), _queue(conn, ids[:1])
    assert [r["id"] for r in health.worklist(conn)] == [first]
    assert [r["id"] for r in health.worklist(conn, limit=10)] == [first, second]


def test_run_once_asks_once_and_writes_the_answer_the_model_and_the_tokens(tmp_path, caplog):
    conn, data, ids = _collection(tmp_path)
    prev = _queue(conn, ids[:1])
    conn.execute("UPDATE health_checks SET state = 'done', status = 'watch', summary = 'A few yellow lower leaves.', finished_at = '2026-10-20T09:00:00.000Z' WHERE id = ?", (prev,))
    check = _queue(conn, ids, QUESTION)
    calls = []
    with caplog.at_level(logging.INFO, logger="fern"):
        assert health.run_once(conn, data, CFG, "6a", NOW, _fake(_answer(reply=REPLY), calls)) is True
    assert len(calls) == 1
    call = calls[0]
    assert call["effort"] == "medium" and call["model"] == CFG.model and "`next_photos`" in call["system"]
    # The photos as they are stored, in the order chosen, each under its date.
    assert [im.caption for im in call["images"]] == ["Photo 1, taken Nov 9, 2026:", "Photo 2, uploaded Nov 10, 2026 (the date it was taken is not known):"]
    assert call["images"][0].data == (data / "photos/2026/11/p0.jpg").read_bytes() and call["images"][0].media_type == "image/jpeg"
    for words in ("Species: Ficus elastica", "Where it is kept: Shelf 2", "about 2 years and 3 months", "USDA 6a",
                  "light: Bright, indirect light", "on Oct 20, 2026, read: watch. A few yellow lower leaves.", QUESTION):
        assert words in call["prompt"]

    row = conn.execute("SELECT * FROM health_checks WHERE id = ?", (check,)).fetchone()
    assert (row["state"], row["status"], row["error"], row["finished_at"]) == ("done", "needs_attention", None, iso(NOW))
    assert row["summary"].startswith("Mealybugs on the lower leaves")
    assert (row["model"], row["input_tokens"], row["output_tokens"]) == (CFG.model, 5810, 2950)
    assert row["prompt_version"] == care.load_prompt(health.PROMPT_PATH)[0]
    assert json.loads(row["answer"])["reply"] == REPLY
    assert [r.getMessage() for r in caplog.records] == [
        f"health check {check} (specimen 1, Ficus elastica): needs_attention, 1 finding, 2 photos, a question, "
        "by anthropic/claude-sonnet-5.5 at effort medium, 5810 tokens in, 2950 out"
    ]
    # Done: off the list, and the next tick has nothing to do.
    assert health.run_once(conn, data, CFG, "6a", NOW, _explode) is False


def test_a_check_carries_what_the_owner_said_about_the_plant_into_the_prompt(tmp_path):
    conn, data, ids = _collection(tmp_path)
    check = _queue(conn, ids)
    conn.execute("UPDATE health_checks SET setting = 'indoors', light = 'artificial' WHERE id = ?", (check,))
    conn.commit()
    calls = []
    assert health.run_once(conn, data, CFG, "6a", NOW, _fake(_answer(), calls)) is True
    assert "The owner says it grows: indoors" in calls[0]["prompt"] and "The owner says its light is: artificial light" in calls[0]["prompt"]
    # The next check says neither, and its prompt claims neither.
    _queue(conn, ids[:1])
    assert health.run_once(conn, data, CFG, "6a", NOW, _fake(_answer(), calls)) is True
    assert "The owner says" not in calls[1]["prompt"]
    assert conn.execute("SELECT COUNT(*) FROM health_checks WHERE state = 'done'").fetchone()[0] == 2


def test_a_failed_call_is_one_loud_line_and_a_failed_row_that_is_never_retried(tmp_path, caplog):
    conn, data, ids = _collection(tmp_path)
    check = _queue(conn, ids)

    def down(*_a, **_k):
        raise llm.LlmError("the gateway has no credits to bill (402)")

    with caplog.at_level(logging.INFO, logger="fern"):
        assert health.run_once(conn, data, CFG, "6a", NOW, down) is True
    assert [r.levelname for r in caplog.records] == ["ERROR"]
    assert caplog.records[0].getMessage() == f"health check {check} (specimen 1) FAILED: LlmError: the gateway has no credits to bill (402)"
    row = conn.execute("SELECT * FROM health_checks WHERE id = ?", (check,)).fetchone()
    assert (row["state"], row["error"], row["model"], row["finished_at"]) == ("failed", "LlmError: the gateway has no credits to bill (402)", CFG.model, iso(NOW))
    assert row["status"] is None and row["answer"] is None
    # Not retried, on this tick or a day later; and a new check for the plant runs.
    assert health.run_once(conn, data, CFG, "6a", NOW + timedelta(days=2), _explode) is False
    again = _queue(conn, ids)
    assert health.run_once(conn, data, CFG, "6a", NOW, _fake(_answer(), [])) is True
    assert conn.execute("SELECT state FROM health_checks WHERE id = ?", (again,)).fetchone()[0] == "done"


def test_an_answer_with_nothing_usable_fails_the_check_with_the_validators_words(tmp_path):
    conn, data, ids = _collection(tmp_path)
    check = _queue(conn, ids)
    assert health.run_once(conn, data, CFG, "6a", NOW, _fake(_answer(summary=...), [])) is True
    row = conn.execute("SELECT state, error FROM health_checks WHERE id = ?", (check,)).fetchone()
    assert tuple(row) == ("failed", "InvalidAnswer: there is no summary")


def test_an_adjusted_answer_is_stored_and_the_journal_line_says_what_was_adjusted(tmp_path, caplog):
    conn, data, ids = _collection(tmp_path)
    check = _queue(conn, ids, QUESTION)
    flawed = _answer(findings=[_finding()] * 5, confidence="high")  # a question and no reply, five findings, no confidence
    with caplog.at_level(logging.INFO, logger="fern"):
        assert health.run_once(conn, data, CFG, "6a", NOW, _fake(flawed, [])) is True
    row = conn.execute("SELECT state, status, answer, error FROM health_checks WHERE id = ?", (check,)).fetchone()
    assert (row["state"], row["status"], row["error"]) == ("done", "needs_attention", None)
    stored = json.loads(row["answer"])
    assert len(stored["findings"]) == 4 and stored["confidence"] is None and "reply" not in stored
    assert [r.levelname for r in caplog.records] == ["INFO"]
    assert caplog.records[0].getMessage().endswith(
        "5810 tokens in, 2950 out, adjusted: no reply to the owner's question; finding 5 dropped (more than 4); no usable confidence"
    )


def test_a_check_without_a_care_sheet_or_a_question_and_with_a_photo_since_removed(tmp_path):
    conn, data, ids = _collection(tmp_path, photos=3, care_sheet=False)
    check = _queue(conn, ids)
    conn.execute("DELETE FROM photos WHERE id = ?", (ids[1],))
    conn.commit()
    calls = []
    assert health.run_once(conn, data, CFG, None, NOW, _fake(_answer(findings=[_finding(photo=2)]), calls)) is True
    assert [im.caption.split(",")[0] for im in calls[0]["images"]] == ["Photo 1", "Photo 2"]  # numbered as sent to the model
    assert "Its care sheet: not written yet." in calls[0]["prompt"] and "Previous health check: none." in calls[0]["prompt"]
    assert "Household hardiness zone: not set" in calls[0]["prompt"] and "The owner asked no question" in calls[0]["prompt"]
    assert conn.execute("SELECT state FROM health_checks WHERE id = ?", (check,)).fetchone()[0] == "done"


def test_a_check_whose_photos_are_all_gone_fails_without_calling_the_model(tmp_path):
    conn, data, ids = _collection(tmp_path)
    check = _queue(conn, ids)
    conn.execute("DELETE FROM photos")
    conn.commit()
    assert health.run_once(conn, data, CFG, "6a", NOW, _explode) is True
    assert conn.execute("SELECT state, error FROM health_checks WHERE id = ?", (check,)).fetchone()[:] == (
        "failed", "LookupError: none of the chosen photos can be read any more")


def test_with_no_model_a_queued_check_fails_with_the_reason_and_nothing_is_called(tmp_path):
    conn, data, ids = _collection(tmp_path)
    assert health.run_once(conn, data, None, "6a", NOW, _explode) is False  # nothing queued: nothing to do
    check = _queue(conn, ids)
    assert health.run_once(conn, data, None, "6a", NOW, _explode) is True
    row = conn.execute("SELECT state, error FROM health_checks WHERE id = ?", (check,)).fetchone()
    assert row["state"] == "failed" and "AI_GATEWAY_API_KEY" in row["error"]


def test_a_check_left_running_by_a_stop_is_failed_on_the_next_start(tmp_path):
    conn, _, ids = _collection(tmp_path)
    stuck, waiting = _queue(conn, ids), _queue(conn, ids)
    conn.execute("UPDATE health_checks SET state = 'running' WHERE id = ?", (stuck,))
    conn.commit()
    assert health.fail_interrupted(conn, NOW) == 1
    assert [tuple(r) for r in conn.execute("SELECT id, state FROM health_checks ORDER BY id")] == [(stuck, "failed"), (waiting, "queued")]
    assert "Fern stopped" in conn.execute("SELECT error FROM health_checks WHERE id = ?", (stuck,)).fetchone()[0]


def test_idle_tick_gives_a_queued_health_check_the_tick_before_anything_else(tmp_path, monkeypatch):
    from fern import enrich

    conn, data, ids = _collection(tmp_path)  # its photos have no thumbnail yet, so the sweep has work too
    _queue(conn, ids)
    calls = []
    monkeypatch.setattr(health, "run_check", lambda *a, **k: calls.append("health") or "line")
    monkeypatch.setattr(worker, "sweep_once", lambda *a, **k: calls.append("sweep") or True)
    monkeypatch.setattr(enrich, "run_once", lambda *a, **k: calls.append("enrich") or True)
    monkeypatch.setattr(care, "run_once", lambda *a, **k: calls.append("care") or True)
    assert worker.idle_tick(conn, data, NOW, CFG, "6a", CFG) is True
    assert calls == ["health"]


# --- what leaves the box -----------------------------------------------------


def test_llm_payload_is_unchanged_without_images_or_effort():
    body = llm.payload("sys", "facts", "anthropic/claude-sonnet-5.5")
    assert body == {"model": "anthropic/claude-sonnet-5.5", "max_tokens": llm.MAX_TOKENS, "system": "sys",
                    "messages": [{"role": "user", "content": "facts"}]}
    assert llm.payload("sys", "facts", "m", images=[], effort=None) == llm.payload("sys", "facts", "m")


def test_llm_payload_with_images_and_effort():
    images = [llm.Image("Photo 1, taken Nov 9, 2026:", b"\xff\xd8\xffjpeg"), llm.Image("Photo 2:", b"\x89PNG", "image/png")]
    body = llm.payload("sys", "facts", "m", images=images, effort="medium")
    assert set(body) == {"model", "max_tokens", "system", "messages", "output_config"}  # still no sampling, no thinking settings
    assert body["output_config"] == {"effort": "medium"}
    content = body["messages"][0]["content"]
    assert [b["type"] for b in content] == ["text", "image", "text", "image", "text"]
    assert content[0]["text"] == "Photo 1, taken Nov 9, 2026:" and content[-1]["text"] == "facts"
    assert content[1]["source"] == {"type": "base64", "media_type": "image/jpeg", "data": base64.standard_b64encode(b"\xff\xd8\xffjpeg").decode()}
    assert content[3]["source"]["media_type"] == "image/png"
    json.dumps(body)  # serialisable as it stands


def test_llm_config_reads_the_health_model_from_its_own_variable():
    env = {"AI_GATEWAY_API_KEY": "k", "CONSERVATORY_LLM": "anthropic/claude-opus-5.5", "CONSERVATORY_HEALTH_LLM": "anthropic/claude-haiku-5.5"}
    assert llm.config(env).model == "anthropic/claude-opus-5.5"  # care sheets: untouched
    assert llm.config(env, model_var=health.MODEL_VAR).model == "anthropic/claude-haiku-5.5"
    assert llm.config({"AI_GATEWAY_API_KEY": "k"}, model_var=health.MODEL_VAR).model == llm.DEFAULT_MODEL
    assert llm.config({}, model_var=health.MODEL_VAR) is None
