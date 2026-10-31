import { describe, expect, it } from "vitest";
import { familyExample, genusExample, relativeCount, relativesLine, relativesOf } from "./relatives";
import type { SpeciesListRow } from "./species-page";

const row = (id: number, scientificName: string, genus: string | null, family: string | null, specimens = 1, commonName: string | null = null): SpeciesListRow => ({
  id,
  scientificName,
  cultivar: null,
  commonName,
  canonicalName: null,
  family,
  genus,
  specimens,
  thumbUrl: null,
});

const rows = [
  row(1, "Ficus elastica", "Ficus", "Moraceae", 2, "India Rubber Fig"),
  row(2, "Ficus lyrata", "Ficus", "Moraceae", 1, "Fiddle-leaf fig"),
  row(3, "Ficus benjamina", "Ficus", "Moraceae", 3, "Weeping fig"),
  row(4, "Morus alba", "Morus", "Moraceae", 1, "White mulberry"),
  row(5, "Artocarpus heterophyllus", "Artocarpus", "Moraceae", 1, "Jackfruit"),
  row(6, "Sedum pachyphyllum", "Sedum", "Crassulaceae", 4, "Jellybeans"),
  row(7, "Ficus pumila", "Ficus", "Moraceae", 0, "Creeping fig"), // every one of them died
  row(8, "Typed name", null, null),
];
const ficus = rows[0];

describe("relativesOf", () => {
  it("finds the same genus without the species itself, most owned first, then by name", () => {
    const r = relativesOf(ficus, rows);
    if (!r.placed) throw new Error("placed");
    expect(r.sameGenus.map((s) => s.id)).toEqual([3, 2]);
  });

  it("keeps same-genus species out of the same-family group", () => {
    const r = relativesOf(ficus, rows);
    if (!r.placed) throw new Error("placed");
    expect(r.sameFamily.map((s) => s.id)).toEqual([5, 4]); // Jackfruit before White mulberry: one each, then A to Z
    expect(r.sameFamily.some((s) => s.genus === "Ficus")).toBe(false);
  });

  it("orders by most owned before name", () => {
    const r = relativesOf(row(9, "Crassula ovata", "Crassula", "Crassulaceae"), [
      ...rows,
      row(10, "Echeveria elegans", "Echeveria", "Crassulaceae", 1, "Mexican snowball"),
    ]);
    if (!r.placed) throw new Error("placed");
    expect(r.sameFamily.map((s) => s.id)).toEqual([6, 10]);
  });

  it("matches genus and family without regard to case or stray spaces", () => {
    const r = relativesOf(row(11, "Ficus altissima", "ficus ", "MORACEAE"), rows);
    if (!r.placed) throw new Error("placed");
    expect(r.sameGenus.map((s) => s.id)).toEqual([3, 1, 2]);
    expect(r.sameFamily.map((s) => s.id)).toEqual([5, 4]);
  });

  it("leaves out species with nothing left alive", () => {
    const r = relativesOf(ficus, rows);
    expect(r.placed && r.sameGenus.some((s) => s.id === 7)).toBe(false);
  });

  it("is not placed when the genus or the family is missing", () => {
    expect(relativesOf(rows[7], rows)).toEqual({ placed: false });
    expect(relativesOf({ id: 12, genus: "Ficus", family: null }, rows)).toEqual({ placed: false });
    expect(relativesOf({ id: 12, genus: null, family: "Moraceae" }, rows)).toEqual({ placed: false });
    expect(relativesOf({ id: 12, genus: " ", family: "Moraceae" }, rows)).toEqual({ placed: false });
  });

  it("gives a lonely species empty groups, not null", () => {
    expect(relativesOf(rows[5], rows)).toEqual({ placed: true, genus: "Sedum", family: "Crassulaceae", sameGenus: [], sameFamily: [] });
  });
});

describe("relativeCount and relativesLine", () => {
  it("counts both groups and says so on the specimen page", () => {
    const r = relativesOf(ficus, rows);
    expect(relativeCount(r)).toBe(4);
    expect(relativesLine(r)).toBe("Related to 4 other species you own.");
  });

  it("speaks in the singular, the lonely and the unplaced cases", () => {
    expect(relativesLine(relativesOf(row(13, "Morus nigra", "Morus", "Moraceae"), [rows[3]]))).toBe("Related to 1 other species you own.");
    expect(relativesLine(relativesOf(rows[5], rows))).toBe("Nothing else you own shares its genus or family yet.");
    expect(relativesLine(relativesOf(rows[7], rows))).toMatch(/once Fern has placed it/);
    expect(relativeCount({ placed: false })).toBe(0);
  });
});

describe("the marks' examples", () => {
  it("names the plants on screen for genus", () => {
    expect(genusExample(ficus, relativesOf(ficus, rows))).toBe("Ficus elastica, Ficus benjamina and Ficus lyrata are all Ficus.");
    expect(genusExample(ficus, relativesOf(ficus, [ficus, rows[1]]))).toBe("Ficus elastica and Ficus lyrata are both Ficus.");
    expect(genusExample(rows[5], relativesOf(rows[5], rows))).toBe("Sedum pachyphyllum is the only Sedum you have so far.");
    expect(genusExample(rows[7], relativesOf(rows[7], rows))).toBeUndefined();
  });

  it("names the genera on screen for family", () => {
    expect(familyExample(relativesOf(ficus, rows))).toBe("Ficus, Artocarpus and Morus are different genera, all Moraceae.");
    expect(familyExample(relativesOf(ficus, [ficus, rows[3]]))).toBe("Ficus and Morus are different genera, both Moraceae.");
    expect(familyExample(relativesOf(rows[5], rows))).toBe("Sedum is the only genus of Crassulaceae you have so far.");
    expect(familyExample({ placed: false })).toBeUndefined();
  });
});
