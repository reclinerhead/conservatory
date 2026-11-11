import { describe, expect, it } from "vitest";
import {
  canSend,
  capReached,
  checkRequest,
  checksToday,
  dailyMax,
  defaultSelection,
  failureWords,
  healthView,
  newestFirst,
  sameAsLast,
  togglePhoto,
  type HealthRow,
} from "./health";

const photo = (id: number, takenAt: string | null, uploadedAt = "2026-11-01T08:00:00.000Z") => ({ id, takenAt, uploadedAt });

describe("the default selection", () => {
  it("is the three newest, newest first, whatever order the page has them in", () => {
    // The page leads with the main photo (here the oldest), then newest first.
    const photos = [photo(1, "2026-08-01T10:00:00"), photo(5, "2026-11-09T10:00:00"), photo(4, "2026-11-02T10:00:00"), photo(3, "2026-10-20T10:00:00"), photo(2, "2026-09-01T10:00:00")];
    expect(defaultSelection(photos)).toEqual([5, 4, 3]);
  });

  it("is every photo when the plant has fewer than three", () => {
    expect(defaultSelection([photo(1, "2026-08-01T10:00:00"), photo(2, "2026-09-01T10:00:00")])).toEqual([2, 1]);
    expect(defaultSelection([photo(7, null)])).toEqual([7]);
    expect(defaultSelection([])).toEqual([]);
  });

  it("dates a photo by its upload when it carried no date, and breaks ties by the newer id", () => {
    const photos = [photo(1, null, "2026-11-05T08:00:00.000Z"), photo(2, "2026-11-03T10:00:00"), photo(3, null, "2026-11-05T08:00:00.000Z")];
    expect(newestFirst(photos).map((p) => p.id)).toEqual([3, 1, 2]);
  });
});

describe("the one-to-three limit", () => {
  it("adds up to three and leaves a fourth out", () => {
    expect(togglePhoto([1, 2], 3)).toEqual([1, 2, 3]);
    expect(togglePhoto([1, 2, 3], 4)).toEqual([1, 2, 3]);
  });

  it("unticks, down to none, and none cannot be sent", () => {
    expect(togglePhoto([1, 2, 3], 2)).toEqual([1, 3]);
    expect(togglePhoto([1], 1)).toEqual([]);
    expect(canSend([])).toBe(false);
    expect(canSend([1])).toBe(true);
    expect(canSend([1, 2, 3])).toBe(true);
    expect(canSend([1, 2, 3, 4])).toBe(false);
  });

  it("holds in the route's body check", () => {
    expect(checkRequest({ photoIds: [3, 1] })).toEqual({ ok: true, photoIds: [3, 1], question: null });
    expect(checkRequest({ photoIds: [1, 1, 2] })).toEqual({ ok: true, photoIds: [1, 2], question: null });
    expect(checkRequest({ photoIds: [] })).toEqual({ ok: false, error: "choose at least one photo" });
    expect(checkRequest({})).toEqual({ ok: false, error: "choose at least one photo" });
    expect(checkRequest(null)).toEqual({ ok: false, error: "choose at least one photo" });
    expect(checkRequest({ photoIds: [1, 2, 3, 4] })).toEqual({ ok: false, error: "choose at most 3 photos" });
    expect(checkRequest({ photoIds: [1, "2"] }).ok).toBe(false);
    expect(checkRequest({ photoIds: [0] }).ok).toBe(false);
    expect(checkRequest({ photoIds: [1.5] }).ok).toBe(false);
  });

  it("trims the question, treats an empty one as none, and stops at 500 characters", () => {
    expect(checkRequest({ photoIds: [1], question: "  Why are the tips brown?  " })).toEqual({ ok: true, photoIds: [1], question: "Why are the tips brown?" });
    expect(checkRequest({ photoIds: [1], question: "   " })).toEqual({ ok: true, photoIds: [1], question: null });
    expect(checkRequest({ photoIds: [1], question: null })).toEqual({ ok: true, photoIds: [1], question: null });
    expect(checkRequest({ photoIds: [1], question: "x".repeat(500) }).ok).toBe(true);
    expect(checkRequest({ photoIds: [1], question: "x".repeat(501) })).toEqual({ ok: false, error: "the question is at most 500 characters" });
    expect(checkRequest({ photoIds: [1], question: 7 }).ok).toBe(false);
  });
});

describe("same as the last check", () => {
  const last = { photoIds: [5, 4, 3], question: "Why are the tips brown?" };

  it("ignores the order of the photos and compares the question trimmed", () => {
    expect(sameAsLast(last, [3, 5, 4], "  Why are the tips brown? ")).toBe(true);
    expect(sameAsLast({ photoIds: [1], question: null }, [1], "  ")).toBe(true);
  });

  it("is not the same with another photo, fewer photos, or another question", () => {
    expect(sameAsLast(last, [5, 4, 2], last.question)).toBe(false);
    expect(sameAsLast(last, [5, 4], last.question)).toBe(false);
    expect(sameAsLast(last, [5, 4, 3], null)).toBe(false);
    expect(sameAsLast(last, [5, 4, 3], "why are the tips brown?")).toBe(false);
  });

  it("is never the same when there is no last check", () => {
    expect(sameAsLast(null, [1], null)).toBe(false);
  });
});

describe("the daily cap", () => {
  // Local wall-clock times, so the test holds in any timezone.
  const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString();
  const now = new Date(2026, 10, 11, 14, 0);

  it("counts the checks started on the station's local day", () => {
    const started = [at(10, 23, 59), at(11, 0, 0), at(11, 9), at(11, 13, 59), at(12, 0, 1), "not a date"];
    expect(checksToday(started, now)).toBe(3);
    expect(checksToday([], now)).toBe(0);
  });

  it("is reached at the cap and not before", () => {
    const three = [at(11, 1), at(11, 2), at(11, 3)];
    expect(capReached(three, now, 4)).toBe(false);
    expect(capReached(three, now, 3)).toBe(true);
    expect(capReached([], now, 0)).toBe(true);
  });

  it("reads the cap from the environment, 20 when unset or not a number", () => {
    expect(dailyMax(undefined)).toBe(20);
    expect(dailyMax("")).toBe(20);
    expect(dailyMax("lots")).toBe(20);
    expect(dailyMax("-3")).toBe(20);
    expect(dailyMax(" 5 ")).toBe(5);
    expect(dailyMax("0")).toBe(0);
  });
});

describe("a check's row", () => {
  const answer = {
    status: "needs_attention",
    summary: "Mealybugs on the lower leaves; treat this week.",
    reply: "Those are mealybugs. Wipe them off with rubbing alcohol.",
    findings: [{ seen: "White tufts in the leaf joints.", photo: 1, likelihood: "likely", remedy: "Dab each tuft with rubbing alcohol every 5–7 days." }],
    confidence: { level: "medium", why: "Only one photo shows them close up." },
    next_photos: ["the underside of a lower leaf"],
  };
  const row = (over: Partial<HealthRow> = {}): HealthRow => ({
    id: 4,
    state: "done",
    photo_ids: "[5,4]",
    question: "What are these?",
    status: "needs_attention",
    summary: answer.summary,
    answer: JSON.stringify(answer),
    model: "anthropic/claude-sonnet-5.5",
    error: null,
    created_at: "2026-11-11T14:00:00.000Z",
    finished_at: "2026-11-11T14:00:40.000Z",
    ...over,
  });

  it("is waiting while queued or running, with its photos and question", () => {
    for (const state of ["queued", "running"] as const) {
      expect(healthView(row({ state, status: null, summary: null, answer: null, finished_at: null }))).toEqual({
        id: 4,
        kind: "waiting",
        createdAt: "2026-11-11T14:00:00.000Z",
        finishedAt: null,
        photoIds: [5, 4],
        question: "What are these?",
      });
    }
  });

  it("is done with the status, summary, reply, findings, confidence and next photos", () => {
    expect(healthView(row())).toEqual({
      id: 4,
      kind: "done",
      createdAt: "2026-11-11T14:00:00.000Z",
      finishedAt: "2026-11-11T14:00:40.000Z",
      photoIds: [5, 4],
      question: "What are these?",
      status: "needs_attention",
      summary: answer.summary,
      reply: answer.reply,
      findings: answer.findings,
      confidence: answer.confidence,
      nextPhotos: answer.next_photos,
      model: "anthropic/claude-sonnet-5.5",
    });
  });

  it("has no reply when no question was asked", () => {
    const v = healthView(row({ question: null, answer: JSON.stringify({ ...answer, reply: undefined }) }));
    expect(v.kind === "done" && v.reply).toBe(null);
    expect(v.question).toBe(null);
  });

  it("is failed with the reason in plain words", () => {
    const v = healthView(row({ state: "failed", status: null, summary: null, answer: null, error: "LlmError: the gateway has no credits to bill (402)" }));
    expect(v).toMatchObject({ kind: "failed", why: "Fern couldn't get an answer from the model: the gateway has no credits to bill (402)." });
  });

  it("reads a done row it cannot parse as failed, not as a blank result", () => {
    expect(healthView(row({ answer: "{" }))).toMatchObject({ kind: "failed", why: "This check's result could not be read back." });
    expect(healthView(row({ status: "thriving" })).kind).toBe("failed");
    expect(healthView(row({ photo_ids: "nope" })).photoIds).toEqual([]);
  });

  it("puts each kind of failure in its own words", () => {
    expect(failureWords("InvalidAnswer: summary runs long (188 characters)")).toMatch(/not in a form Fern could use/);
    expect(failureWords("LookupError: none of the chosen photos can be read any more")).toMatch(/were removed/);
    expect(failureWords("Interrupted: Fern stopped while this check was running")).toMatch(/restarted/);
    expect(failureWords("Off: Fern has no AI_GATEWAY_API_KEY, so health checks are off")).toMatch(/off on this box/);
    expect(failureWords("OSError: disk")).toBe("Something went wrong before Fern could finish: disk.");
    expect(failureWords(null)).toBe("Something went wrong before Fern could finish.");
  });
});
