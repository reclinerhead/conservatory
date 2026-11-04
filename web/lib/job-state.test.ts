import { describe, expect, it } from "vitest";
import { isSettled } from "./job-state";

describe("isSettled", () => {
  it("settles a job Fern named, one it found nothing for, and one it gave up on", () => {
    expect(isSettled({ status: "identified", nextAttemptAt: null })).toBe(true);
    expect(isSettled({ status: "rejected", nextAttemptAt: null })).toBe(true);
    expect(isSettled({ status: "failed", nextAttemptAt: null })).toBe(true);
  });

  it("keeps a job Fern will retry, and one it has not answered, with Fern", () => {
    expect(isSettled({ status: "failed", nextAttemptAt: "2026-11-04T19:00:30.000Z" })).toBe(false);
    expect(isSettled({ status: "queued", nextAttemptAt: null })).toBe(false);
    expect(isSettled({ status: "identifying", nextAttemptAt: null })).toBe(false);
  });
});
