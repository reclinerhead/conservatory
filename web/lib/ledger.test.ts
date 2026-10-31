import { describe, expect, it } from "vitest";
import { count, ledgerEntries, waitingDetail, waitingLabel } from "./ledger";

describe("count", () => {
  it("pluralizes by default and accepts an irregular plural", () => {
    expect(count(0, "plant")).toBe("0 plants");
    expect(count(1, "plant")).toBe("1 plant");
    expect(count(2, "species", "species")).toBe("2 species");
  });
});

describe("ledgerEntries", () => {
  it("reads specimens, species, locations in that order with honest zeros", () => {
    expect(ledgerEntries({ specimens: 0, species: 0, places: 0, waiting: 0 })).toEqual([
      "0 specimens",
      "0 species",
      "0 locations",
    ]);
    expect(ledgerEntries({ specimens: 150, species: 1, places: 1, waiting: 9 })).toEqual([
      "150 specimens",
      "1 species",
      "1 location",
    ]);
  });
});

describe("waitingLabel and waitingDetail", () => {
  it("name the empty state and count the rest", () => {
    expect(waitingLabel(0)).toBe("Nothing waiting for a name");
    expect(waitingLabel(1)).toBe("1 plant waiting for a name");
    expect(waitingLabel(7)).toBe("7 plants waiting for a name");
    expect(waitingDetail(0)).toMatch(/Add a photo/);
    expect(waitingDetail(1)).toBe("Fern has a suggestion ready.");
    expect(waitingDetail(3)).toBe("Fern has suggestions ready for all three.");
    expect(waitingDetail(7)).toBe("Fern has suggestions ready for all 7.");
  });
});
