import { describe, expect, it } from "vitest";
import { CARE_CELLS, careScopeLine, careState, careWrittenLine, modelLabel, parseCells, type CareRow } from "./care";

const cell = (headline = "Bright, indirect light") => ({
  headline,
  text: "Keep it near a window that gets morning sun.",
  figures: [{ label: "light", value: "4–6 hours", basis: "an understorey tree" }],
});
const cellsJson = (over: Record<string, unknown> = {}) => JSON.stringify({ ...Object.fromEntries(CARE_CELLS.map((c) => [c.key, cell()])), ...over });

const row = (over: Partial<CareRow> = {}): CareRow => ({
  zone: "6a",
  model: "anthropic/claude-sonnet-5.5",
  cells: cellsJson(),
  notes: JSON.stringify({ subject: "Ficus elastica", level: "species" }),
  writtenAt: "2026-10-31T19:00:00.000Z",
  triedAt: "2026-10-31T19:00:00.000Z",
  error: null,
  ...over,
});

describe("parseCells", () => {
  it("reads the six cells and keeps only whole figures", () => {
    const cells = parseCells(cellsJson({ soil: { ...cell("Gritty mix"), figures: [{ label: "repot", value: "2 years" }, { label: "pH", value: "6–7", basis: "common practice" }] } }));
    expect(Object.keys(cells!)).toEqual(CARE_CELLS.map((c) => c.key));
    expect(cells!.soil.figures).toEqual([{ label: "pH", value: "6–7", basis: "common practice" }]);
  });

  it("refuses a sheet with a cell missing or empty, and junk", () => {
    expect(parseCells(cellsJson({ dormancy: undefined }))).toBeNull();
    expect(parseCells(cellsJson({ water: { headline: "", text: "x" } }))).toBeNull();
    expect(parseCells("{")).toBeNull();
    expect(parseCells(null)).toBeNull();
    expect(parseCells("[]")).toBeNull();
  });
});

describe("careState", () => {
  const placed = { configured: true, gbifKey: 7835333, enrichedAt: "2026-10-31T18:00:00.000Z" };

  it("shows a written sheet whatever else is true, flagging a failed rewrite", () => {
    const s = careState({ row: row(), ...placed, configured: false });
    expect(s.kind).toBe("sheet");
    if (s.kind !== "sheet") return;
    expect([s.level, s.subject, s.zone, s.lastTryFailed]).toEqual(["species", "Ficus elastica", "6a", false]);
    const failedRewrite = careState({ row: row({ error: "LlmError: 402" }), ...placed });
    expect(failedRewrite.kind === "sheet" && failedRewrite.lastTryFailed).toBe(true);
  });

  it("reads the genus level from the notes, and survives notes that are junk", () => {
    const g = careState({ row: row({ notes: JSON.stringify({ subject: "Echeveria", level: "genus" }) }), ...placed });
    expect(g.kind === "sheet" && [g.level, g.subject]).toEqual(["genus", "Echeveria"]);
    const j = careState({ row: row({ notes: "{" }), ...placed });
    expect(j.kind === "sheet" && [j.level, j.subject]).toEqual(["species", null]);
  });

  it("says why there is no sheet: no model, not placed, a failed first try, or on its way", () => {
    expect(careState({ row: null, ...placed, configured: false })).toEqual({ kind: "off" });
    expect(careState({ row: null, ...placed, gbifKey: null, enrichedAt: null })).toEqual({ kind: "unplaced", enriched: false });
    expect(careState({ row: null, ...placed, gbifKey: null })).toEqual({ kind: "unplaced", enriched: true });
    expect(careState({ row: row({ cells: null, writtenAt: null, error: "InvalidAnswer: missing soil" }), ...placed })).toEqual({
      kind: "failed",
      error: "InvalidAnswer: missing soil",
      triedAt: "2026-10-31T19:00:00.000Z",
    });
    expect(careState({ row: null, ...placed })).toEqual({ kind: "writing" });
  });
});

describe("the lines", () => {
  it("names the model as a person would", () => {
    expect(modelLabel("anthropic/claude-sonnet-5.5")).toBe("Claude Sonnet 5.5");
    expect(modelLabel("claude-opus-5-5")).toBe("Claude Opus 5 5");
    expect(modelLabel(null)).toBe("a language model");
  });

  it("says the zone and the level, and who wrote it when", () => {
    const s = careState({ row: row(), configured: true, gbifKey: 1, enrichedAt: null });
    if (s.kind !== "sheet") throw new Error("sheet");
    expect(careScopeLine(s)).toBe("For zone 6a · written once for this species");
    expect(careScopeLine({ ...s, level: "genus", subject: "Echeveria", zone: null })).toBe("No household zone set · written for the genus Echeveria");
    expect(careWrittenLine(s)).toBe("Written by Claude Sonnet 5.5 on Oct 31, 2026 from GBIF's taxonomy and Wikipedia's summary");
  });
});
