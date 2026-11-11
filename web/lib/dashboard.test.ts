import { describe, expect, it } from "vitest";
import { barTwelfths, familyTally, generaShown, localDay, recentSpecies, spotlightPick } from "./dashboard";
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
    hasSummary: false,
    thumbUrl: null,
    imageUrl: null,
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

describe("familyTally", () => {
  it("counts species with a living plant in each family, most first, then by name", () => {
    const rows = [
      row(1, { family: "Cactaceae", genus: "Rhipsalis" }),
      row(2, { family: "Crassulaceae", genus: "Echeveria" }),
      row(3, { family: "Crassulaceae", genus: "Aeonium" }),
      row(4, { family: "Araceae", genus: "Monstera" }),
      row(5, { family: "Moraceae", genus: "Ficus", specimens: 0, gone: 1 }),
    ];
    expect(familyTally(rows).families.map((f) => [f.name, f.species])).toEqual([
      ["Crassulaceae", 2],
      ["Araceae", 1],
      ["Cactaceae", 1],
    ]);
  });

  it("counts case and space variants of one family together", () => {
    const rows = [row(1, { family: "Crassulaceae" }), row(2, { family: " crassulaceae" }), row(3, { family: "CRASSULACEAE " })];
    expect(familyTally(rows).families).toHaveLength(1);
    expect(familyTally(rows).families[0].species).toBe(3);
  });

  it("shows the spelling most of a family's species carry", () => {
    const rows = [
      row(1, { commonName: "Aloe", family: "crassulaceae" }),
      row(2, { commonName: "Bear-paws", family: "Crassulaceae" }),
      row(3, { commonName: "Lipstick", family: "Crassulaceae" }),
    ];
    expect(familyTally(rows).families[0].name).toBe("Crassulaceae");
  });

  it("breaks a tie between spellings by the first species A to Z", () => {
    const rows = [row(1, { commonName: "Zebra plant", family: "Crassulaceae" }), row(2, { commonName: "Aloe", family: "crassulaceae " })];
    expect(familyTally(rows).families[0].name).toBe("crassulaceae");
  });

  it("lists each family's genera once, A to Z, whatever their spelling", () => {
    const rows = [
      row(1, { family: "Crassulaceae", genus: "Echeveria" }),
      row(2, { family: "Crassulaceae", genus: "Aeonium" }),
      row(3, { family: "Crassulaceae", genus: "echeveria " }),
      row(4, { family: "Crassulaceae", genus: null }),
      row(5, { family: "Crassulaceae", genus: "Dudleya" }),
    ];
    expect(familyTally(rows).families[0].genera).toEqual(["Aeonium", "Dudleya", "Echeveria"]);
  });

  it("counts the living species with no family as unplaced", () => {
    const rows = [row(1, { family: null }), row(2, { family: " " }), row(3, { family: null, specimens: 0, gone: 1 }), row(4, { family: "Araceae" })];
    expect(familyTally(rows)).toEqual({ families: [{ name: "Araceae", species: 1, genera: [] }], unplaced: 2 });
  });

  it("is empty for no species", () => {
    expect(familyTally([])).toEqual({ families: [], unplaced: 0 });
  });
});

describe("generaShown", () => {
  it("names up to three genera, then how many more", () => {
    expect(generaShown(["Aeonium", "Dudleya", "Echeveria", "Graptopetalum", "Sedum"])).toEqual({ names: ["Aeonium", "Dudleya", "Echeveria"], more: 2 });
    expect(generaShown(["Aeonium", "Dudleya", "Echeveria"])).toEqual({ names: ["Aeonium", "Dudleya", "Echeveria"], more: 0 });
    expect(generaShown([])).toEqual({ names: [], more: 0 });
  });
});

describe("barTwelfths", () => {
  it("measures a family against the top one, in twelfths", () => {
    expect(barTwelfths(12, 12)).toBe(12);
    expect(barTwelfths(6, 12)).toBe(6);
    expect(barTwelfths(2, 3)).toBe(8);
  });

  it("never draws less than one twelfth, or more than the whole", () => {
    expect(barTwelfths(1, 40)).toBe(1);
    expect(barTwelfths(5, 4)).toBe(12);
  });

  it("draws nothing when there is no top family", () => {
    expect(barTwelfths(0, 0)).toBe(0);
  });
});

describe("spotlightPick", () => {
  const eligible = [1, 2, 3, 4, 5].map((id) => row(id, { hasSummary: true }));
  const day = (d: number, h = 12) => new Date(2026, 10, d, h, 0);

  it("keeps the same species all day, from just after midnight to just before the next", () => {
    const morning = spotlightPick(eligible, new Date(2026, 10, 4, 0, 1));
    const night = spotlightPick(eligible, new Date(2026, 10, 4, 23, 59));
    expect(morning?.id).toBe(night?.id);
  });

  it("moves on the next day", () => {
    expect(spotlightPick(eligible, day(5))?.id).not.toBe(spotlightPick(eligible, day(4))?.id);
  });

  it("shows every eligible species once over as many days as there are of them", () => {
    const ids = [4, 5, 6, 7, 8].map((d) => spotlightPick(eligible, day(d))?.id);
    expect([...ids].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("does not walk the species in the order they were added", () => {
    const ids = Array.from({ length: 5 }, (_, i) => spotlightPick(eligible, day(4 + i))!.id);
    const rotations = [0, 1, 2, 3, 4].map((k) => [1, 2, 3, 4, 5].map((_, i) => ((k + i) % 5) + 1));
    expect(rotations).not.toContainEqual(ids);
  });

  it("picks the same species whatever order the rows arrive in", () => {
    expect(spotlightPick([...eligible].reverse(), day(4))?.id).toBe(spotlightPick(eligible, day(4))?.id);
  });

  it("leaves out a species with no summary, or no living plant", () => {
    const rows = [row(1, { hasSummary: false }), row(2, { hasSummary: true, specimens: 0, gone: 1 }), row(3, { hasSummary: true })];
    for (const d of [4, 5, 6]) expect(spotlightPick(rows, day(d))?.id).toBe(3);
  });

  it("is null when no species is eligible", () => {
    expect(spotlightPick([row(1)], day(4))).toBeNull();
    expect(spotlightPick([], day(4))).toBeNull();
  });
});

describe("localDay", () => {
  it("turns at local midnight", () => {
    expect(localDay(new Date(2026, 10, 4, 23, 59))).toBe(localDay(new Date(2026, 10, 4, 0, 0)));
    expect(localDay(new Date(2026, 10, 5, 0, 0))).toBe(localDay(new Date(2026, 10, 4, 0, 0)) + 1);
  });
});
