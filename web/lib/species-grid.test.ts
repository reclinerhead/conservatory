import { describe, expect, it } from "vitest";
import { GONE, NO_LOCATION } from "./collection";
import { ALL, countAt, gridRows, placeChips, readSort, selectedPlace, showingSpecies, SORTS, tileLine } from "./species-grid";
import type { SpeciesListRow } from "./species-page";

function row(id: number, over: Partial<SpeciesListRow> = {}): SpeciesListRow {
  const places = over.places ?? [];
  return {
    id,
    scientificName: `Genus sp${id}`,
    cultivar: null,
    commonName: null,
    canonicalName: null,
    family: null,
    genus: null,
    specimens: places.reduce((n, p) => n + p.n, 0),
    places,
    gone: 0,
    latest: null,
    addedAt: "2026-01-01T00:00:00.000Z",
    hasSummary: false,
    thumbUrl: null,
    imageUrl: null,
    ...over,
  };
}

// Two jade plants on the shelf and one in the living room; a fig in the
// living room; a sedum with no location; a hosta that died; an aeonium with
// one living plant on the shelf and one gifted away.
const ROWS = [
  row(1, { commonName: "Jade plant", scientificName: "Crassula ovata", family: "Crassulaceae", places: [{ at: "Basement shelf", n: 2 }, { at: "Living room", n: 1 }] }),
  row(2, { commonName: "India Rubber Fig", scientificName: "Ficus elastica", cultivar: "Ruby", genus: "Ficus", family: "Moraceae", places: [{ at: "Living room", n: 1 }] }),
  row(3, { scientificName: "Sedum pachyphyllum", family: "Crassulaceae", places: [{ at: null, n: 1 }] }),
  row(4, { commonName: "Hosta", scientificName: "Hosta", gone: 1 }),
  row(5, { commonName: "Tree Aeonium", scientificName: "Aeonium arboreum", family: "Crassulaceae", places: [{ at: "Basement shelf", n: 1 }], gone: 1 }),
];

describe("placeChips", () => {
  it("leads with All over the species with a living plant, then places A to Z, then the special chips", () => {
    expect(placeChips(ROWS)).toEqual([
      { key: ALL, label: "All", n: 4 },
      { key: "Basement shelf", label: "Basement shelf", n: 2 },
      { key: "Living room", label: "Living room", n: 2 },
      { key: NO_LOCATION.key, label: NO_LOCATION.label, n: 1 },
      { key: GONE.key, label: GONE.label, n: 2 },
    ]);
  });

  it("draws the special chips only when someone is in them", () => {
    expect(placeChips([ROWS[1]])).toEqual([
      { key: ALL, label: "All", n: 1 },
      { key: "Living room", label: "Living room", n: 1 },
    ]);
    expect(placeChips([])).toEqual([{ key: ALL, label: "All", n: 0 }]);
  });

  it("keeps two spellings of a place apart, as the plant pages write them", () => {
    const rows = [row(1, { places: [{ at: "Shelf A", n: 1 }] }), row(2, { places: [{ at: "shelf A", n: 1 }] })];
    expect(placeChips(rows).map((c) => c.key)).toEqual([ALL, "Shelf A", "shelf A"]);
  });
});

describe("selectedPlace", () => {
  it("selects a chip on the row and falls back to All for anything else", () => {
    const chips = placeChips(ROWS);
    expect(selectedPlace(chips, "Living room")).toBe("Living room");
    expect(selectedPlace(chips, GONE.key)).toBe(GONE.key);
    expect(selectedPlace(chips, "Garage")).toBe(ALL);
    expect(selectedPlace(chips, null)).toBe(ALL);
  });
});

describe("gridRows", () => {
  it("shows every species with a living plant at All, by the name the tile shows, A to Z", () => {
    expect(gridRows(ROWS).map((r) => r.id)).toEqual([2, 1, 3, 5]);
    expect(gridRows(ROWS, { sort: "name" }).map((r) => r.id)).toEqual([2, 1, 3, 5]);
  });

  it("narrows to a place, to no location, or to the plants no longer here", () => {
    expect(gridRows(ROWS, { at: "Basement shelf" }).map((r) => r.id)).toEqual([1, 5]);
    expect(gridRows(ROWS, { at: "Living room" }).map((r) => r.id)).toEqual([2, 1]);
    expect(gridRows(ROWS, { at: NO_LOCATION.key }).map((r) => r.id)).toEqual([3]);
    expect(gridRows(ROWS, { at: GONE.key }).map((r) => r.id)).toEqual([4, 5]);
  });

  it("breaks a tie on name by id, ignoring case", () => {
    const rows = [row(3, { commonName: "jade plant", places: [{ at: null, n: 1 }] }), row(2, { commonName: "Jade plant", places: [{ at: null, n: 1 }] })];
    expect(gridRows(rows).map((r) => r.id)).toEqual([2, 3]);
  });

  it("puts the species with the newest plant first under Latest added, then by name", () => {
    const rows = [
      row(1, { commonName: "Aloe", latest: "2026-10-01T12:00:00Z", places: [{ at: "Porch", n: 1 }] }),
      row(2, { commonName: "Fern", latest: "2026-11-03T09:00:00Z", places: [{ at: "Porch", n: 1 }] }),
      row(3, { commonName: "Cactus", latest: "2026-11-03T09:00:00Z", places: [{ at: "Den", n: 1 }] }),
      row(4, { commonName: "Basil", latest: null, places: [{ at: "Porch", n: 1 }] }),
    ];
    expect(gridRows(rows, { sort: "latest" }).map((r) => r.id)).toEqual([3, 2, 1, 4]);
    expect(gridRows(rows, { sort: "latest", at: "Porch" }).map((r) => r.id)).toEqual([2, 1, 4]);
    expect(gridRows(rows, { sort: "latest", q: "a" }).map((r) => r.id)).toEqual([3, 1, 4]);
  });

  it("combines the search with the chip, and searches family and genus", () => {
    expect(gridRows(ROWS, { q: "crassulaceae" }).map((r) => r.id)).toEqual([1, 3, 5]);
    expect(gridRows(ROWS, { q: "crassulaceae", at: "Living room" }).map((r) => r.id)).toEqual([1]);
    expect(gridRows(ROWS, { q: "ruby" }).map((r) => r.id)).toEqual([2]);
    expect(gridRows(ROWS, { q: "zzz" })).toEqual([]);
  });
});

describe("tileLine", () => {
  it("at All, counts the plants and names the one place or counts several", () => {
    expect(tileLine(ROWS[0], ALL)).toBe("3 plants · 2 places");
    expect(tileLine(ROWS[1], ALL)).toBe("1 plant · Living room");
    expect(tileLine(ROWS[2], ALL)).toBe("1 plant");
    expect(tileLine(row(9, { places: [{ at: "Porch", n: 1 }, { at: null, n: 1 }] }), ALL)).toBe("2 plants · 1 place");
  });

  it("at a place, says how many are here and of how many", () => {
    expect(tileLine(ROWS[0], "Basement shelf")).toBe("2 of 3 plants here");
    expect(tileLine(ROWS[0], "Living room")).toBe("1 of 3 plants here");
    expect(tileLine(ROWS[1], "Living room")).toBe("1 plant here");
    expect(tileLine(ROWS[2], NO_LOCATION.key)).toBe("1 plant here");
  });

  it("at No longer here, counts the plants gifted or died", () => {
    expect(tileLine(ROWS[3], GONE.key)).toBe("1 plant no longer here");
    expect(tileLine(row(9, { gone: 2 }), GONE.key)).toBe("2 plants no longer here");
  });

  it("counts by chip through countAt", () => {
    expect(countAt(ROWS[4], ALL)).toBe(1);
    expect(countAt(ROWS[4], GONE.key)).toBe(1);
    expect(countAt(ROWS[4], "Living room")).toBe(0);
  });
});

describe("the sort options", () => {
  it("lists Name first as the default and reads a stored value safely", () => {
    expect(SORTS.map((s) => s.key)).toEqual(["name", "latest"]);
    expect(readSort("latest")).toBe("latest");
    expect(readSort("name")).toBe("name");
    expect(readSort("most")).toBe("name");
    expect(readSort(null)).toBe("name");
    expect(readSort(undefined)).toBe("name");
  });
});

describe("showingSpecies", () => {
  it("says all, a fraction of the chip's count, or nothing", () => {
    expect(showingSpecies(12, 12)).toBe("Showing all 12 species");
    expect(showingSpecies(1, 1)).toBe("Showing 1 species");
    expect(showingSpecies(3, 12)).toBe("Showing 3 of 12 species");
    expect(showingSpecies(0, 0)).toBe("Nothing to show yet");
  });
});
