import { describe, expect, it } from "vitest";
import { familyCount, recentSpecies } from "./dashboard";
import type { SpeciesListRow } from "./species-page";

function row(id: number, over: Partial<SpeciesListRow> = {}): SpeciesListRow {
  return {
    id,
    scientificName: `Genus sp${id}`,
    cultivar: null,
    commonName: null,
    canonicalName: null,
    family: null,
    genus: null,
    specimens: 1,
    places: [],
    gone: 0,
    latest: null,
    addedAt: "2026-01-01T00:00:00.000Z",
    thumbUrl: null,
    ...over,
  };
}

describe("recentSpecies", () => {
  it("lists the species that joined last, newest first", () => {
    const rows = [
      row(1, { addedAt: "2026-10-01T12:00:00.000Z" }),
      row(2, { addedAt: "2026-11-03T09:00:00.000Z" }),
      row(3, { addedAt: "2026-10-20T08:30:00.000Z" }),
    ];
    expect(recentSpecies(rows, 4).map((r) => r.id)).toEqual([2, 3, 1]);
  });

  it("goes by when the species joined, not by its newest plant", () => {
    const rows = [
      row(1, { addedAt: "2026-06-01T00:00:00.000Z", latest: "2026-11-04T10:00:00.000Z" }),
      row(2, { addedAt: "2026-11-01T00:00:00.000Z", latest: "2026-11-01T00:00:00.000Z" }),
    ];
    expect(recentSpecies(rows, 4).map((r) => r.id)).toEqual([2, 1]);
  });

  it("puts the newer id first when two joined at the same moment", () => {
    const at = "2026-11-02T11:16:32.000Z";
    expect(recentSpecies([row(4, { addedAt: at }), row(9, { addedAt: at }), row(6, { addedAt: at })], 4).map((r) => r.id)).toEqual([9, 6, 4]);
  });

  it("leaves out a species with no living plant", () => {
    const rows = [row(1, { addedAt: "2026-11-03T00:00:00.000Z", specimens: 0, gone: 1 }), row(2)];
    expect(recentSpecies(rows, 4).map((r) => r.id)).toEqual([2]);
  });

  it("stops at the limit", () => {
    const rows = [1, 2, 3, 4, 5, 6].map((id) => row(id, { addedAt: `2026-11-0${id}T00:00:00.000Z` }));
    expect(recentSpecies(rows, 4).map((r) => r.id)).toEqual([6, 5, 4, 3]);
  });

  it("returns what there is when there are fewer than the limit, and nothing for none", () => {
    expect(recentSpecies([row(1), row(2)], 4)).toHaveLength(2);
    expect(recentSpecies([], 4)).toEqual([]);
  });

  it("leaves the rows it was given in their order", () => {
    const rows = [row(1, { addedAt: "2026-01-01T00:00:00.000Z" }), row(2, { addedAt: "2026-02-01T00:00:00.000Z" })];
    recentSpecies(rows, 4);
    expect(rows.map((r) => r.id)).toEqual([1, 2]);
  });
});

describe("familyCount", () => {
  it("counts each family once", () => {
    const rows = [row(1, { family: "Crassulaceae" }), row(2, { family: "Crassulaceae" }), row(3, { family: "Cactaceae" })];
    expect(familyCount(rows)).toBe(2);
  });

  it("counts case and stray-space variants of one family once", () => {
    const rows = [row(1, { family: "Crassulaceae" }), row(2, { family: "crassulaceae " }), row(3, { family: " CRASSULACEAE" })];
    expect(familyCount(rows)).toBe(1);
  });

  it("adds nothing for a species with no family, or a blank one", () => {
    expect(familyCount([row(1, { family: null }), row(2, { family: "  " }), row(3, { family: "Moraceae" })])).toBe(1);
  });

  it("adds nothing for a species with no living plant", () => {
    expect(familyCount([row(1, { family: "Moraceae", specimens: 0, gone: 2 }), row(2, { family: "Araceae" })])).toBe(1);
  });

  it("is zero for no species", () => {
    expect(familyCount([])).toBe(0);
  });
});
