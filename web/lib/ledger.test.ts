import { describe, expect, it } from "vitest";
import { count, ledgerEntries, waitingLabel } from "./ledger";

describe("count", () => {
  it("pluralizes by default and accepts an irregular plural", () => {
    expect(count(0, "plant")).toBe("0 plants");
    expect(count(1, "plant")).toBe("1 plant");
    expect(count(2, "species", "species")).toBe("2 species");
  });
});

describe("ledgerEntries", () => {
  it("reads plants, species, places in that order with honest zeros", () => {
    expect(ledgerEntries({ specimens: 0, species: 0, places: 0, waiting: 0 })).toEqual([
      "0 plants",
      "0 species",
      "0 places",
    ]);
    expect(ledgerEntries({ specimens: 150, species: 1, places: 3, waiting: 9 })).toEqual([
      "150 plants",
      "1 species",
      "3 places",
    ]);
  });
});

describe("waitingLabel", () => {
  it("names the empty state and counts the rest", () => {
    expect(waitingLabel(0)).toBe("Nothing waiting for a name");
    expect(waitingLabel(1)).toBe("1 plant waiting for a name");
    expect(waitingLabel(7)).toBe("7 plants waiting for a name");
  });
});
