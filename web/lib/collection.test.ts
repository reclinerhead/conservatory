import { describe, expect, it } from "vitest";
import {
  dayLabel,
  GONE,
  groupTiles,
  locationChips,
  matchesQuery,
  metaLine,
  monthYear,
  NO_LOCATION,
  showingLine,
  speciesLabel,
  tileName,
  type Tile,
} from "./collection";

function tile(over: Partial<Tile> & { id: number }): Tile {
  return {
    nickname: null,
    scientificName: "Echeveria agavoides",
    cultivar: null,
    location: null,
    acquiredOn: null,
    status: "alive",
    createdAt: `2026-10-${String(over.id).padStart(2, "0")}T12:00:00Z`,
    thumbUrl: null,
    ...over,
  };
}

const TILES: Tile[] = [
  tile({ id: 1, nickname: "Granddaddy", scientificName: "Echeveria", cultivar: "Black Prince", location: "Basement shelf A" }),
  tile({ id: 2, scientificName: "Ficus elastica", cultivar: "Ruby", location: "Living room" }),
  tile({ id: 3, scientificName: "Sedum pachyphyllum", location: "basement shelf A" }),
  tile({ id: 4, nickname: "Mom's jade", scientificName: "Crassula ovata" }),
  tile({ id: 5, scientificName: "Hosta", location: "Front bed", status: "died" }),
  tile({ id: 6, nickname: "Office jade", scientificName: "Crassula ovata", location: "Living room", status: "gifted" }),
];

describe("names and dates", () => {
  it("writes the cultivar in single quotes and prefers the nickname", () => {
    expect(speciesLabel("Echeveria", "Black Prince")).toBe("Echeveria 'Black Prince'");
    expect(speciesLabel("Ficus elastica", null)).toBe("Ficus elastica");
    expect(tileName(TILES[0])).toBe("Granddaddy");
    expect(tileName(TILES[1])).toBe("Ficus elastica 'Ruby'");
  });

  it("reads month and day labels from the string without a time zone", () => {
    expect(monthYear("2019-05-01")).toBe("May 2019");
    expect(monthYear("2026-10-31T23:59:59Z")).toBe("Oct 2026");
    expect(monthYear(null)).toBeNull();
    expect(monthYear("2026-13-01")).toBeNull();
    expect(dayLabel("2026-10-05T00:10:00")).toBe("Oct 5, 2026");
    expect(dayLabel("nope")).toBeNull();
  });

  it("builds the meta line from location and the acquired date, falling back to when it was added", () => {
    expect(metaLine({ location: "Front bed", acquiredOn: "2019-05-01", createdAt: "2026-10-01T00:00:00Z" })).toBe("Front bed · since May 2019");
    expect(metaLine({ location: null, acquiredOn: null, createdAt: "2026-10-01T00:00:00Z" })).toBe("added Oct 2026");
    expect(metaLine({ location: "Porch", acquiredOn: null, createdAt: "2026-10-01T00:00:00Z" })).toBe("Porch · added Oct 2026");
  });
});

describe("matchesQuery", () => {
  it("matches any part of the nickname or the species label, ignoring case, and everything on blank", () => {
    expect(matchesQuery(TILES[0], "grand")).toBe(true);
    expect(matchesQuery(TILES[0], "black prince")).toBe(true);
    expect(matchesQuery(TILES[1], "RUBY")).toBe(true);
    expect(matchesQuery(TILES[2], "ficus")).toBe(false);
    expect(matchesQuery(TILES[2], "   ")).toBe(true);
  });
});

describe("groupTiles", () => {
  it("groups by location A to Z, then no location, then the plants no longer here, newest first within each", () => {
    const groups = groupTiles(TILES);
    expect(groups.map((g) => g.label)).toEqual(["Basement shelf A", "basement shelf A", "Living room", NO_LOCATION.label, GONE.label]);
    expect(groups[2].tiles.map((t) => t.id)).toEqual([2]);
    expect(groups[4].tiles.map((t) => t.id)).toEqual([6, 5]);
  });

  it("orders two tiles created in the same second by id, newest first", () => {
    const same = [tile({ id: 7, createdAt: "2026-10-01T00:00:00Z" }), tile({ id: 9, createdAt: "2026-10-01T00:00:00Z" }), tile({ id: 8, createdAt: "2026-10-02T00:00:00Z" })];
    expect(groupTiles(same)[0].tiles.map((t) => t.id)).toEqual([8, 9, 7]);
  });

  it("narrows to one location, to the plants with none, or to the gone ones", () => {
    expect(groupTiles(TILES, { where: "Living room" }).map((g) => g.tiles.map((t) => t.id))).toEqual([[2]]);
    expect(groupTiles(TILES, { where: NO_LOCATION.key }).map((g) => g.tiles.map((t) => t.id))).toEqual([[4]]);
    expect(groupTiles(TILES, { where: GONE.key })[0].tiles.map((t) => t.id)).toEqual([6, 5]);
  });

  it("applies the search before grouping and drops empty groups", () => {
    const groups = groupTiles(TILES, { q: "jade" });
    expect(groups.map((g) => g.label)).toEqual([NO_LOCATION.label, GONE.label]);
    expect(groupTiles(TILES, { q: "zzz" })).toEqual([]);
    expect(groupTiles(TILES, { q: "jade", where: "Living room" })).toEqual([]);
  });
});

describe("locationChips", () => {
  it("leads with All and counts from the whole collection, skipping empty special groups", () => {
    expect(locationChips(TILES)).toEqual([
      { key: "all", label: "All", n: 6 },
      { key: "Basement shelf A", label: "Basement shelf A", n: 1 },
      { key: "basement shelf A", label: "basement shelf A", n: 1 },
      { key: "Living room", label: "Living room", n: 1 },
      { key: NO_LOCATION.key, label: NO_LOCATION.label, n: 1 },
      { key: GONE.key, label: GONE.label, n: 2 },
    ]);
    expect(locationChips([TILES[1]])).toEqual([
      { key: "all", label: "All", n: 1 },
      { key: "Living room", label: "Living room", n: 1 },
    ]);
    expect(locationChips([])).toEqual([{ key: "all", label: "All", n: 0 }]);
  });
});

describe("showingLine", () => {
  it("says all, a fraction, or nothing", () => {
    expect(showingLine(42, 42)).toBe("Showing all 42");
    expect(showingLine(9, 42)).toBe("Showing 9 of 42");
    expect(showingLine(0, 0)).toBe("Nothing to show yet");
  });
});
