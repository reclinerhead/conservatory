import { describe, expect, it } from "vitest";
import { locationChoices, sameLocation } from "./locations";

// knownLocations' order: most plants first.
const KNOWN = ["Basement Garden", "Dining Room", "Upstairs Garden", "Front bed"];

describe("the Location field's list", () => {
  it("offers every known location while the field still holds the plant's saved one (#129)", () => {
    // The regression: a datalist filtered by the field's own value and offered "Basement Garden" alone.
    expect(locationChoices(KNOWN, "Basement Garden", "Basement Garden")).toEqual({ rows: KNOWN, fresh: null });
    expect(locationChoices(KNOWN, " Basement Garden ", "Basement Garden").rows).toEqual(KNOWN);
  });

  it("offers every known location, in the given order, for an empty field", () => {
    expect(locationChoices(KNOWN, "", "Basement Garden")).toEqual({ rows: KNOWN, fresh: null });
    expect(locationChoices(KNOWN, "   ", "")).toEqual({ rows: KNOWN, fresh: null });
    expect(locationChoices([], "", "")).toEqual({ rows: [], fresh: null });
  });

  it("narrows to the locations that contain the typed text, ignoring case, in the given order", () => {
    expect(locationChoices(KNOWN, "garden", "Basement Garden")).toEqual({ rows: ["Basement Garden", "Upstairs Garden"], fresh: null });
    expect(locationChoices(KNOWN, "ROOM", "")).toEqual({ rows: ["Dining Room"], fresh: null });
    expect(locationChoices(KNOWN, " bed ", "")).toEqual({ rows: ["Front bed"], fresh: null });
  });

  it("keeps text that matches none, and reports it as a new location", () => {
    expect(locationChoices(KNOWN, " Sunroom ", "Basement Garden")).toEqual({ rows: [], fresh: "Sunroom" });
    expect(locationChoices([], "Sunroom", "")).toEqual({ rows: [], fresh: "Sunroom" });
  });

  it("does not report a known location as new, whatever its case or surrounding spaces", () => {
    expect(locationChoices(KNOWN, "  dining room ", "Basement Garden")).toEqual({ rows: ["Dining Room"], fresh: null });
    expect(locationChoices(KNOWN, "Dining Room", "Basement Garden")).toEqual({ rows: ["Dining Room"], fresh: null });
  });

  it("tells the same location by any case and spacing", () => {
    expect(sameLocation(" dining room", "Dining Room ")).toBe(true);
    expect(sameLocation("Dining Room", "Dining")).toBe(false);
  });
});
