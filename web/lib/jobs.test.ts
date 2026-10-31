import { describe, expect, it } from "vitest";
import { nextWaitingJob } from "./jobs";

describe("nextWaitingJob", () => {
  it("moves to the next later job, wraps to the first, and stops when alone", () => {
    expect(nextWaitingJob([3, 5, 9], 5)).toBe(9);
    expect(nextWaitingJob([3, 5, 9], 9)).toBe(3);
    expect(nextWaitingJob([3, 5, 9], 4)).toBe(5); // current already confirmed and gone from the list
    expect(nextWaitingJob([5], 5)).toBeNull();
    expect(nextWaitingJob([], 5)).toBeNull();
  });
});
