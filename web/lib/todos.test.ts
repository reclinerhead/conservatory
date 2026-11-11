import { describe, expect, it } from "vitest";
import type { HealthRow } from "./health";
import { addRequest, countsLine, doneRequest, doneTodos, findingAt, findingTodos, latestPending, pendingTodos, todoId } from "./todos";

describe("what the routes must be sent", () => {
  it("adding takes a check's id and a finding's place from 0", () => {
    expect(addRequest({ checkId: 7, finding: 0 })).toEqual({ ok: true, checkId: 7, finding: 0 });
    expect(addRequest({ checkId: 7, finding: 3 })).toEqual({ ok: true, checkId: 7, finding: 3 });
  });

  it("adding refuses anything else, and never takes the text from the page", () => {
    for (const body of [null, "x", {}, { checkId: 7 }, { finding: 0 }, { checkId: 0, finding: 0 }, { checkId: "7", finding: 0 }, { checkId: 7, finding: -1 }, { checkId: 7, finding: 1.5 }, { checkId: 7, finding: "0" }]) {
      expect(addRequest(body).ok).toBe(false);
    }
    expect(addRequest({ checkId: 7, finding: 1, seen: "x", remedy: "y" })).toEqual({ ok: true, checkId: 7, finding: 1 });
  });

  it("ticking takes done as true or false and nothing looser", () => {
    expect(doneRequest({ done: true })).toEqual({ ok: true, done: true });
    expect(doneRequest({ done: false })).toEqual({ ok: true, done: false });
    for (const body of [null, {}, { done: 1 }, { done: "true" }, { done: null }]) expect(doneRequest(body).ok).toBe(false);
  });

  it("a to-do's id is a positive whole number", () => {
    expect(todoId("12")).toBe(12);
    for (const raw of ["0", "-1", "1.5", "abc", "", "12abc", " 12"]) expect(todoId(raw)).toBeNull();
  });
});

const row = (over: Partial<HealthRow> = {}): HealthRow => ({
  id: 1,
  state: "done",
  photo_ids: "[1]",
  question: null,
  status: "watch",
  summary: "Fairly healthy.",
  answer: JSON.stringify({
    findings: [
      { seen: "The stem is tall and bare.", photo: 1, likelihood: "possible", remedy: "Bring the lamp closer." },
      { seen: "No remedy here.", photo: 1, likelihood: "likely" }, // dropped by the page, so it holds no place
      { seen: "The pot is covered with pebbles.", photo: 1, likelihood: "likely", remedy: "Lift them out." },
    ],
  }),
  model: "anthropic/claude-sonnet-5.5",
  error: null,
  created_at: "2026-11-11T18:00:00.000Z",
  finished_at: "2026-11-11T18:01:00.000Z",
  ...over,
});

describe("the finding a to-do copies", () => {
  it("is the one at that place among the findings the page draws", () => {
    expect(findingAt(row(), 0)).toEqual({ seen: "The stem is tall and bare.", photo: 1, likelihood: "possible", remedy: "Bring the lamp closer." });
    expect(findingAt(row(), 1)).toEqual({ seen: "The pot is covered with pebbles.", photo: 1, likelihood: "likely", remedy: "Lift them out." });
  });

  it("is nothing past the end, or for a place that is not one", () => {
    expect(findingAt(row(), 2)).toBeNull();
    expect(findingAt(row(), -1)).toBeNull();
    expect(findingAt(row(), 0.5)).toBeNull();
  });

  it("is nothing for a check that is not done or cannot be read", () => {
    expect(findingAt(row({ state: "running" }), 0)).toBeNull();
    expect(findingAt(row({ state: "failed" }), 0)).toBeNull();
    expect(findingAt(row({ answer: "not json" }), 0)).toBeNull();
    expect(findingAt(row({ answer: null }), 0)).toBeNull();
  });
});

describe("each finding's line in the Health card", () => {
  it("says not added, pending or done, finding by finding", () => {
    expect(
      findingTodos(4, [
        { id: 9, findingIndex: 2, completedAt: null },
        { id: 8, findingIndex: 0, completedAt: "2026-11-14T09:00:00.000Z" },
      ]),
    ).toEqual([{ kind: "done", id: 8, completedAt: "2026-11-14T09:00:00.000Z" }, { kind: "none" }, { kind: "pending", id: 9 }, { kind: "none" }]);
  });

  it("is all not added with nothing on the list, and empty for a check with no findings", () => {
    expect(findingTodos(2, [])).toEqual([{ kind: "none" }, { kind: "none" }]);
    expect(findingTodos(0, [{ id: 1, findingIndex: 0, completedAt: null }])).toEqual([]);
  });
});

const todo = (id: number, createdAt: string, completedAt: string | null = null) => ({ id, createdAt, completedAt });

describe("the page's lists", () => {
  const all = [
    todo(1, "2026-11-10T10:00:00.000Z"),
    todo(2, "2026-11-11T10:00:00.000Z", "2026-11-12T08:00:00.000Z"),
    todo(3, "2026-11-11T10:00:00.000Z"),
    todo(4, "2026-11-11T10:00:00.000Z"),
    todo(5, "2026-11-09T10:00:00.000Z", "2026-11-13T08:00:00.000Z"),
    todo(6, "2026-11-08T10:00:00.000Z"),
    todo(7, "2026-11-12T10:00:00.000Z", "2026-11-12T08:00:00.000Z"),
  ];

  it("to do is what is not done, newest first, the later id first in a tie", () => {
    expect(pendingTodos(all).map((t) => t.id)).toEqual([4, 3, 1, 6]);
  });

  it("done is the one done last first, whenever it was added", () => {
    expect(doneTodos(all).map((t) => t.id)).toEqual([5, 7, 2]);
  });

  it("neither reorders the list it was given", () => {
    const before = all.map((t) => t.id);
    pendingTodos(all);
    doneTodos(all);
    expect(all.map((t) => t.id)).toEqual(before);
  });

  it("the dashboard shows the three newest still to do, fewer when there are fewer", () => {
    expect(latestPending(all).map((t) => t.id)).toEqual([4, 3, 1]);
    expect(latestPending(all.slice(0, 2)).map((t) => t.id)).toEqual([1]);
    expect(latestPending([])).toEqual([]);
  });

  it("the counts line keeps its zeros", () => {
    expect(countsLine(2, 5)).toBe("2 to do · 5 done");
    expect(countsLine(0, 0)).toBe("0 to do · 0 done");
  });
});
