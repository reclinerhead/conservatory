import { describe, expect, it } from "vitest";
import { firstCommonName, nextWaitingJob, photoIdsFrom, planJob } from "./jobs";

describe("nextWaitingJob", () => {
  it("moves to the next later job, wraps to the first, and stops when alone", () => {
    expect(nextWaitingJob([3, 5, 9], 5)).toBe(9);
    expect(nextWaitingJob([3, 5, 9], 9)).toBe(3);
    expect(nextWaitingJob([3, 5, 9], 4)).toBe(5); // current already confirmed and gone from the list
    expect(nextWaitingJob([5], 5)).toBeNull();
    expect(nextWaitingJob([], 5)).toBeNull();
  });
});

describe("photoIdsFrom", () => {
  it("takes one to five distinct positive integers and nothing else", () => {
    expect(photoIdsFrom({ photoIds: [3] })).toEqual([3]);
    expect(photoIdsFrom({ photoIds: [1, 2, 3, 4, 5] })).toEqual([1, 2, 3, 4, 5]);
    expect(photoIdsFrom({ photoIds: [] })).toBeNull();
    expect(photoIdsFrom({ photoIds: [1, 2, 3, 4, 5, 6] })).toBeNull();
    expect(photoIdsFrom({ photoIds: [1, 1] })).toBeNull();
    expect(photoIdsFrom({ photoIds: [0] })).toBeNull();
    expect(photoIdsFrom({ photoIds: [1.5] })).toBeNull();
    expect(photoIdsFrom({ photoIds: ["3"] })).toBeNull();
    expect(photoIdsFrom({ photoIds: 3 })).toBeNull();
    expect(photoIdsFrom({})).toBeNull();
    expect(photoIdsFrom(null)).toBeNull();
    expect(photoIdsFrom("[3]")).toBeNull();
  });
});

describe("planJob", () => {
  const free = (id: number) => ({ id, jobId: null, specimenId: null });

  it("makes a job from photos on nothing", () => {
    expect(planJob([1, 2, 3], [free(1), free(2), free(3)])).toEqual({ kind: "make" });
  });

  it("is 404 when a photo is gone", () => {
    expect(planJob([1, 2], [free(1)])).toEqual({ kind: "refuse", status: 404, error: "some of these photos are gone" });
    expect(planJob([1], [])).toMatchObject({ status: 404 });
  });

  it("is 409 when a photo is already on a plant", () => {
    expect(planJob([1, 2], [free(1), { id: 2, jobId: 7, specimenId: 4 }])).toEqual({ kind: "refuse", status: 409, error: "already on a plant" });
  });

  it("answers the job every photo is already on, so a lost response is not a second job", () => {
    const on7 = (id: number) => ({ id, jobId: 7, specimenId: null });
    expect(planJob([1, 2], [on7(1), on7(2)])).toEqual({ kind: "same", jobId: 7 });
  });

  it("is 409 when the photos are split across jobs, or some are on a job and some not", () => {
    expect(planJob([1, 2], [{ id: 1, jobId: 7, specimenId: null }, { id: 2, jobId: 8, specimenId: null }])).toEqual({
      kind: "refuse",
      status: 409,
      error: "these photos are on different jobs",
    });
    expect(planJob([1, 2], [{ id: 1, jobId: 7, specimenId: null }, free(2)])).toEqual({
      kind: "refuse",
      status: 409,
      error: "some of these photos are already on a job",
    });
  });

  it("checks the gone photo before the plant and the job", () => {
    expect(planJob([1, 2], [{ id: 1, jobId: 7, specimenId: 4 }])).toMatchObject({ status: 404 });
  });
});

describe("firstCommonName", () => {
  it("takes the first non-blank name, trimmed", () => {
    expect(firstCommonName('["Happy bean"]')).toBe("Happy bean");
    expect(firstCommonName('["Lipstick", "Lipstick Echeveria"]')).toBe("Lipstick");
    expect(firstCommonName('["", "  ", " Rubber fig "]')).toBe("Rubber fig");
  });

  it("is null for none, bad JSON, or anything but an array of strings", () => {
    expect(firstCommonName("[]")).toBeNull();
    expect(firstCommonName('["", " "]')).toBeNull();
    expect(firstCommonName("not json")).toBeNull();
    expect(firstCommonName('"Happy bean"')).toBeNull();
    expect(firstCommonName("[3, null]")).toBeNull();
    expect(firstCommonName("")).toBeNull();
    expect(firstCommonName(null)).toBeNull();
    expect(firstCommonName(undefined)).toBeNull();
  });
});
