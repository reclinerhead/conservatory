"""The health check: a vision model's reading of a plant's photos (#87).

The owner picks one to three of a plant's photos on its page, optionally asks
something, and presses "Check health". The web app inserts a `health_checks`
row in state `queued` and answers at once; it never calls the model. Fern
takes the oldest queued check on an idle tick, ahead of the thumbnail sweep,
enrichment and care sheets, because someone is waiting on the page. It sends
the photos as they are stored, with the species, where the plant is kept, how
long it has been in the household's care, the date, the zone, the care sheet's
headlines, the previous check and the owner's question, and writes the
validated answer on the row.

One attempt per check. A call that fails, or an answer the validator will not
store, is one loud line and a row in state `failed` with the reason; nothing
retries it, and the owner can start another. No check is ever started by Fern
itself: no schedule, no automatic checks. The model is CONSERVATORY_HEALTH_LLM,
apart from the care sheets' CONSERVATORY_LLM, at effort medium. Each check's
model and tokens are on its row and in the journal.

Everything that decides something is pure and tested (`time_in_care`,
`care_headlines`, `build_prompt`, `parse_answer`, `photo_number`, `media_type`,
`worklist`);
the model call is a parameter the tests replace.
"""

from __future__ import annotations

import json
import logging
import re
import sqlite3
from collections.abc import Callable
from datetime import date, datetime, timezone
from pathlib import Path

from . import care, llm, plantnet
from .queue import iso

log = logging.getLogger("fern")

PROMPT_PATH = Path(__file__).with_name("prompts") / "health_check.md"
MODEL_VAR = "CONSERVATORY_HEALTH_LLM"
EFFORT = "medium"
MAX_PHOTOS = 3
STATUSES = ("healthy", "watch", "needs_attention", "cannot_tell")
LIKELIHOODS = ("likely", "possible")
LEVELS = ("high", "medium", "low")
# The prompt asks for a summary of at most 140 characters. A model cannot
# count characters exactly, and the first live checks came back at 144 and
# 156, so the validator allows some slack before it throws a paid answer
# away. The page holds the sentence in a fixed box and shows it whole when
# the row is opened.
SUMMARY_TARGET = 140
MAX_SUMMARY = 200
MAX_FINDINGS = 4
MAX_NEXT_PHOTOS = 3
# A photo is sent as it is stored. The web app shrinks uploads to a 1280 px
# JPEG of a few hundred KB; anything the model cannot take as it is (a HEIC
# the browser could not draw, or an original over this size) is re-encoded in
# memory for the request alone, as it is for Pl@ntNet. The stored file is
# never touched.
MAX_IMAGE_BYTES = 3_500_000

CompleteFn = Callable[..., llm.Reply]


class InvalidAnswer(ValueError):
    """The model answered, but not with a health check this app will store."""


# ----------------------------------------------------------------------------
# Pure
# ----------------------------------------------------------------------------

_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def _day(text: str | None) -> date | None:
    """The calendar day an ISO date or datetime starts with, or None."""
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", text or "")
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def _day_words(d: date) -> str:
    return f"{_MONTHS[d.month - 1]} {d.day}, {d.year}"


def _span(start: date, today: date) -> str:
    """"3 days", "5 weeks", "7 months", "2 years and 3 months": how long ago `start` was, roughly."""
    days = max(0, (today - start).days)
    if days < 14:
        return "1 day" if days == 1 else f"{days} days"
    if days < 60:
        return f"{days // 7} weeks"
    months = (today.year - start.year) * 12 + today.month - start.month - (1 if today.day < start.day else 0)
    if months < 24:
        return f"{months} month{'s' if months != 1 else ''}"
    years, rest = divmod(months, 12)
    return f"{years} years" + (f" and {rest} month{'s' if rest != 1 else ''}" if rest else "")


def time_in_care(acquired_on: str | None, created_at: str | None, today: date) -> str:
    """How long the household has had the plant, as the prompt says it. From
    the acquired date when the owner gave one, else from when the plant was
    added to the app, which is only a lower bound. Time in care, never age:
    a plant bought full-grown last month is not a month old."""
    got = _day(acquired_on)
    if got and got <= today:
        return f"about {_span(got, today)} (acquired {_day_words(got)})"
    added = _day(created_at)
    if added and added <= today:
        return f"at least {_span(added, today)} (added to the app {_day_words(added)}; when it was acquired is not recorded)"
    return "not recorded"


def care_headlines(cells_json: str | None) -> dict[str, str]:
    """The species' care sheet as its six headlines, in the sheet's order; empty when there is no sheet or it does not parse."""
    try:
        cells = json.loads(cells_json) if cells_json else None
    except json.JSONDecodeError:
        return {}
    if not isinstance(cells, dict):
        return {}
    out = {}
    for k in care.CELL_KEYS:
        head = cells.get(k, {}).get("headline") if isinstance(cells.get(k), dict) else None
        if isinstance(head, str) and head.strip():
            out[k] = head.strip()
    return out


def photo_caption(n: int, photo: sqlite3.Row | dict) -> str:
    """"Photo 2, taken Oct 31, 2026:" or "Photo 2, uploaded Nov 3, 2026 (the date it was taken is not known):"."""
    taken = _day(photo["taken_at"])
    if taken:
        return f"Photo {n}, taken {_day_words(taken)}:"
    up = _day(photo["uploaded_at"])
    return f"Photo {n}, uploaded {_day_words(up)} (the date it was taken is not known):" if up else f"Photo {n}:"


def build_prompt(
    plant: sqlite3.Row | dict,
    photo_count: int,
    question: str | None,
    previous: sqlite3.Row | dict | None,
    zone: str | None,
    today: date,
) -> str:
    """The text that follows the photos: the facts about this plant.

    `plant` carries the species' names, the plant's location and dates, and
    the species' care sheet cells (`care_cells`, JSON or None). `previous` is
    the plant's last finished check (status, summary, finished_at) or None."""
    name = plant["scientific_name"]
    if plant["cultivar"]:
        name += f" '{plant['cultivar']}'"
    lines = [f"Read the health of this plant from the {photo_count} photo{'s' if photo_count != 1 else ''} above.", f"Species: {name}"]
    if plant["common_name"]:
        lines.append(f"Common name: {plant['common_name']}")
    lines.append(f"Where it is kept: {plant['location']}" if plant["location"] else "Where it is kept: not recorded")
    lines.append(f"In the household's care: {time_in_care(plant['acquired_on'], plant['created_at'], today)}")
    lines.append(f"Today: {_day_words(today)}")
    lines.append(f"Household hardiness zone: USDA {zone}" if zone else "Household hardiness zone: not set")
    heads = care_headlines(plant["care_cells"])
    if heads:
        lines.append("Its care sheet, in headlines: " + "; ".join(f"{k}: {v}" for k, v in heads.items()))
    else:
        lines.append("Its care sheet: not written yet.")
    if previous is not None:
        when = _day(previous["finished_at"])
        lines.append(
            f"The previous health check{f', on {_day_words(when)},' if when else ''} read: {previous['status']}. {previous['summary']}"
            " Say whether the plant looks better, worse or the same where the photos show it."
        )
    else:
        lines.append("Previous health check: none.")
    q = re.sub(r"\s+", " ", question or "").strip()
    if q:
        lines.append(
            "The owner asks (their words, between the marks):\n<<<\n" + q + "\n>>>\n"
            "Answer it directly in `reply`, from the photos, with what to do about it. If the photos do not show what they describe, say so."
        )
    else:
        lines.append("The owner asked no question: give a general reading, and leave `reply` out.")
    return "\n".join(lines)


def _text(v: object, field: str, lo: int, hi: int) -> str:
    if not isinstance(v, str):
        raise InvalidAnswer(f"{field} is not text")
    t = re.sub(r"\s+", " ", v).strip()
    if len(t) < lo:
        raise InvalidAnswer(f"{field} is too short ({len(t)} characters)")
    if len(t) > hi:
        raise InvalidAnswer(f"{field} runs long ({len(t)} characters)")
    return t


def _one_of(v: object, field: str, allowed: tuple[str, ...]) -> str:
    if not isinstance(v, str) or v.strip().lower() not in allowed:
        raise InvalidAnswer(f"{field} is {v!r}, not one of {', '.join(allowed)}")
    return v.strip().lower()


def photo_number(v: object, photo_count: int) -> int | None:
    """Which photo a finding points at, read leniently: 1, 1.0, "1" and
    "Photo 1" are all photo 1. Anything else, or a number that is not among
    the photos sent, is None: the finding is kept without a photo. Never a
    reason to fail a check. The first live check with two photos came back
    with "1" as text, and a good paid answer was thrown away over the least
    important field in it."""
    if isinstance(v, bool):
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    if isinstance(v, str):
        digits = re.findall(r"\d+", v)
        v = int(digits[0]) if len(digits) == 1 else None
    return v if isinstance(v, int) and 1 <= v <= photo_count else None


def parse_answer(text: str, asked: bool, photo_count: int = MAX_PHOTOS) -> dict:
    """The model's answer -> the check as the page will show it, or InvalidAnswer.

    A status from the four, a summary of at most 200 characters (the prompt
    asks for 140; see MAX_SUMMARY), none to four
    findings each with what was seen, the photo (read leniently, see
    `photo_number`), a likelihood and a remedy,
    a confidence with its reason, and none to three photos to take next. A
    reply is required when the owner asked something and refused when they
    did not, so the page never shows an answer to a question nobody asked. A
    stray code fence or a sentence around the object is forgiven; keys beyond
    these are dropped."""
    s = text.strip()
    start, end = s.find("{"), s.rfind("}")
    if start < 0 or end <= start:
        raise InvalidAnswer("no JSON object in the answer")
    try:
        body = json.loads(s[start : end + 1])
    except json.JSONDecodeError as exc:
        raise InvalidAnswer(f"the answer is not valid JSON ({exc.msg})") from None
    if not isinstance(body, dict):
        raise InvalidAnswer("the answer is not a JSON object")

    out: dict = {
        "status": _one_of(body.get("status"), "status", STATUSES),
        "summary": _text(body.get("summary"), "summary", 1, MAX_SUMMARY),
    }

    reply = body.get("reply")
    if asked:
        if reply is None:
            raise InvalidAnswer("a question was asked but there is no reply")
        out["reply"] = _text(reply, "reply", 20, 1200)
    elif reply is not None:
        raise InvalidAnswer("a reply was given but no question was asked")

    findings = body.get("findings", [])
    if not isinstance(findings, list) or len(findings) > MAX_FINDINGS:
        raise InvalidAnswer(f"findings must be a list of at most {MAX_FINDINGS}")
    out["findings"] = []
    for i, f in enumerate(findings, 1):
        if not isinstance(f, dict):
            raise InvalidAnswer(f"finding {i} is not an object")
        out["findings"].append(
            {
                "seen": _text(f.get("seen"), f"finding {i} seen", 1, 300),
                "photo": photo_number(f.get("photo"), photo_count),
                "likelihood": _one_of(f.get("likelihood"), f"finding {i} likelihood", LIKELIHOODS),
                "remedy": _text(f.get("remedy"), f"finding {i} remedy", 20, 700),
            }
        )

    conf = body.get("confidence")
    if not isinstance(conf, dict):
        raise InvalidAnswer("confidence is not an object")
    out["confidence"] = {
        "level": _one_of(conf.get("level"), "confidence level", LEVELS),
        "why": _text(conf.get("why"), "confidence why", 1, 300),
    }

    nxt = body.get("next_photos", [])
    if not isinstance(nxt, list) or len(nxt) > MAX_NEXT_PHOTOS:
        raise InvalidAnswer(f"next_photos must be a list of at most {MAX_NEXT_PHOTOS}")
    out["next_photos"] = [_text(p, f"next photo {i}", 1, 160) for i, p in enumerate(nxt, 1)]
    return out


def media_type(data: bytes) -> str | None:
    """The image type the model accepts that these bytes are, by their first bytes; None for anything else (HEIC, a truncated file)."""
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return None


def load_image(path: Path, caption: str) -> llm.Image:
    """A stored photo as the model gets it: the file's own bytes when the
    model can take them, else a 1280 px JPEG made in memory for this request."""
    data = path.read_bytes()
    kind = media_type(data)
    if kind is None or len(data) > MAX_IMAGE_BYTES:
        return llm.Image(caption=caption, data=plantnet.prepare_image(path), media_type="image/jpeg")
    return llm.Image(caption=caption, data=data, media_type=kind)


def worklist(conn: sqlite3.Connection, limit: int = 1) -> list[sqlite3.Row]:
    """Queued checks, oldest first. One per idle tick."""
    return conn.execute("SELECT * FROM health_checks WHERE state = 'queued' ORDER BY id LIMIT ?", (limit,)).fetchall()


# ----------------------------------------------------------------------------
# One check
# ----------------------------------------------------------------------------


def _photo_ids(raw: str | None) -> list[int]:
    try:
        ids = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return []
    return [i for i in ids if isinstance(i, int) and not isinstance(i, bool)][:MAX_PHOTOS] if isinstance(ids, list) else []


def run_check(
    conn: sqlite3.Connection,
    check: sqlite3.Row,
    data_dir: Path,
    cfg: llm.Config,
    zone: str | None,
    now: datetime,
    complete: CompleteFn = llm.complete,
    prompt_path: Path = PROMPT_PATH,
) -> str:
    """Ask the model about one claimed check and write its answer on the row.
    Returns the journal line; raises LlmError, InvalidAnswer or anything else, which the caller records."""
    plant = conn.execute(
        """
        SELECT sp.id, sp.location, sp.acquired_on, sp.created_at,
               s.scientific_name, s.cultivar, s.common_name, c.cells AS care_cells
          FROM specimens sp JOIN species s ON s.id = sp.species_id
          LEFT JOIN care_sheets c ON c.species_id = s.id
         WHERE sp.id = ?
        """,
        (check["specimen_id"],),
    ).fetchone()
    if plant is None:
        raise LookupError(f"no specimen {check['specimen_id']}")

    # The photos in the order they were chosen, those still on this plant.
    images: list[llm.Image] = []
    for pid in _photo_ids(check["photo_ids"]):
        ph = conn.execute("SELECT id, path, taken_at, uploaded_at FROM photos WHERE id = ? AND specimen_id = ?", (pid, plant["id"])).fetchone()
        if ph is None:
            continue
        try:
            images.append(load_image(data_dir / ph["path"], photo_caption(len(images) + 1, ph)))
        except Exception as exc:  # noqa: BLE001  (an unreadable photo is left out; the check goes on with the rest)
            log.warning("health check %d: photo %d (%s) unreadable, left out: %s", check["id"], ph["id"], ph["path"], exc)
    if not images:
        raise LookupError("none of the chosen photos can be read any more")

    previous = conn.execute(
        "SELECT status, summary, finished_at FROM health_checks WHERE specimen_id = ? AND state = 'done' AND id < ? ORDER BY id DESC LIMIT 1",
        (plant["id"], check["id"]),
    ).fetchone()
    question = (check["question"] or "").strip() or None
    version, system = care.load_prompt(prompt_path)
    prompt = build_prompt(plant, len(images), question, previous, zone, now.astimezone().date())
    reply = complete(cfg, system, prompt, images=images, effort=EFFORT)
    answer = parse_answer(reply.text, asked=question is not None, photo_count=len(images))
    with conn:
        conn.execute(
            """
            UPDATE health_checks
               SET state = 'done', status = ?, summary = ?, answer = ?, model = ?, prompt_version = ?,
                   input_tokens = ?, output_tokens = ?, error = NULL, finished_at = ?
             WHERE id = ?
            """,
            (
                answer["status"],
                answer["summary"],
                json.dumps(answer, ensure_ascii=False),
                cfg.model,
                version,
                reply.input_tokens,
                reply.output_tokens,
                iso(now),
                check["id"],
            ),
        )
    n = len(answer["findings"])
    return (
        f"health check {check['id']} (specimen {plant['id']}, {plant['scientific_name']}): {answer['status']}, "
        f"{n} finding{'s' if n != 1 else ''}, {len(images)} photo{'s' if len(images) != 1 else ''}, "
        f"{'a question' if question else 'no question'}, by {cfg.model} at effort {EFFORT}, "
        f"{reply.input_tokens if reply.input_tokens is not None else '?'} tokens in, "
        f"{reply.output_tokens if reply.output_tokens is not None else '?'} out"
    )


def record_failure(conn: sqlite3.Connection, check_id: int, model: str | None, now: datetime, error: str) -> None:
    """The check failed, for good: nothing retries it. The owner can start another."""
    with conn:
        conn.execute(
            "UPDATE health_checks SET state = 'failed', error = ?, model = ?, finished_at = ? WHERE id = ?",
            (error[:300], model, iso(now), check_id),
        )


def fail_interrupted(conn: sqlite3.Connection, now: datetime | None = None) -> int:
    """On start: a check left `running` was cut off when Fern last stopped.
    Nothing would ever finish it, and it would block its plant's next check,
    so it is failed with the reason. Returns how many."""
    now = now or datetime.now(timezone.utc)
    with conn:
        cur = conn.execute(
            "UPDATE health_checks SET state = 'failed', error = 'Interrupted: Fern stopped while this check was running', finished_at = ? WHERE state = 'running'",
            (iso(now),),
        )
    if cur.rowcount:
        log.warning("health checks: %d left running by the last stop, marked failed", cur.rowcount)
    return cur.rowcount


def run_once(
    conn: sqlite3.Connection,
    data_dir: Path,
    cfg: llm.Config | None,
    zone: str | None,
    now: datetime | None = None,
    complete: CompleteFn = llm.complete,
    prompt_path: Path = PROMPT_PATH,
) -> bool:
    """The oldest queued check, if there is one: one attempt, then done or failed. Returns whether there was one."""
    rows = worklist(conn)
    if not rows:
        return False
    now = now or datetime.now(timezone.utc)
    check = rows[0]
    if cfg is None:
        # The web app queues nothing without the key, so this is a key removed
        # from Fern's environment alone. Say so on the row, not by silence.
        error = "Off: Fern has no AI_GATEWAY_API_KEY, so health checks are off"
        log.error("health check %d (specimen %d) FAILED: %s", check["id"], check["specimen_id"], error)
        record_failure(conn, check["id"], None, now, error)
        return True
    with conn:
        conn.execute("UPDATE health_checks SET state = 'running', model = ? WHERE id = ?", (cfg.model, check["id"]))
    try:
        log.info("%s", run_check(conn, check, data_dir, cfg, zone, now, complete, prompt_path))
    except Exception as exc:  # noqa: BLE001  (one loud line per failure, whatever it was)
        error = f"{type(exc).__name__}: {exc}"
        log.error("health check %d (specimen %d) FAILED: %s", check["id"], check["specimen_id"], error[:300])
        record_failure(conn, check["id"], cfg.model, now, error)
    return True
