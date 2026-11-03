import { describe, expect, it } from "vitest";
import { clampStart, codePath, LABELS_PER_SHEET, nextStart, sheetSlots, tagUrl } from "./tags";

describe("tagUrl", () => {
  it("builds <base>/t/<id>", () => {
    expect(tagUrl("https://conservatory.lan", 142)).toBe("https://conservatory.lan/t/142");
    expect(tagUrl("http://192.168.1.40:3000", 7)).toBe("http://192.168.1.40:3000/t/7");
  });

  it("tolerates trailing slashes and stray spaces", () => {
    expect(tagUrl("https://conservatory.lan/", 142)).toBe("https://conservatory.lan/t/142");
    expect(tagUrl("  https://conservatory.lan//  ", 142)).toBe("https://conservatory.lan/t/142");
  });

  it("is null for an unset or non-http(s) base", () => {
    expect(tagUrl(undefined, 1)).toBeNull();
    expect(tagUrl(null, 1)).toBeNull();
    expect(tagUrl("", 1)).toBeNull();
    expect(tagUrl("   ", 1)).toBeNull();
    expect(tagUrl("conservatory.lan", 1)).toBeNull();
    expect(tagUrl("ftp://conservatory.lan", 1)).toBeNull();
    expect(tagUrl("javascript:alert(1)", 1)).toBeNull();
  });
});

/** The cells a path covers, read back from its `M x y h w v1 h-w z` runs. */
function covered(path: string): Set<string> {
  const cells = new Set<string>();
  for (const [, x, y, w] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
    for (let i = 0; i < Number(w); i++) cells.add(`${Number(x) + i},${y}`);
  }
  return cells;
}

describe("codePath", () => {
  it("draws a hand-made matrix as one rectangle per horizontal run", () => {
    // 1 1 0
    // 0 1 0
    // 1 0 1
    const m = { size: 3, data: [1, 1, 0, 0, 1, 0, 1, 0, 1] };
    expect(codePath(m)).toBe("M0 0h2v1h-2zM1 1h1v1h-1zM0 2h1v1h-1zM2 2h1v1h-1z");
  });

  it("covers every dark module and no light one", () => {
    const size = 7;
    const data = Array.from({ length: size * size }, (_, i) => ((i * 7 + (i >> 2)) % 3 === 0 ? 1 : 0));
    const dark = new Set(data.flatMap((v, i) => (v ? [`${i % size},${Math.floor(i / size)}`] : [])));
    expect(covered(codePath({ size, data }))).toEqual(dark);
  });

  it("is empty for an all-light matrix and one run per row for an all-dark one", () => {
    expect(codePath({ size: 2, data: [0, 0, 0, 0] })).toBe("");
    expect(codePath({ size: 2, data: [1, 1, 1, 1] })).toBe("M0 0h2v1h-2zM0 1h2v1h-2z");
  });
});

describe("sheetSlots", () => {
  const kinds = (sheet: ReturnType<typeof sheetSlots>[number]) => sheet.map((s) => s.kind);

  it("gives no sheet for no tags", () => {
    expect(sheetSlots(0, 1)).toEqual([]);
    expect(sheetSlots(0, 13)).toEqual([]);
  });

  it("starts at label k: k − 1 used labels, then the tags in order, then blanks", () => {
    const [sheet, ...more] = sheetSlots(12, 13);
    expect(more).toEqual([]);
    expect(sheet).toHaveLength(LABELS_PER_SHEET);
    expect(kinds(sheet).slice(0, 12)).toEqual(Array(12).fill("used"));
    expect(sheet.slice(12, 24)).toEqual(Array.from({ length: 12 }, (_, index) => ({ kind: "tag", index })));
    expect(kinds(sheet).slice(24)).toEqual(Array(6).fill("blank"));
  });

  it("flows what is left onto further sheets", () => {
    const sheets = sheetSlots(30, 25);
    expect(sheets).toHaveLength(2);
    expect(sheets[0].filter((s) => s.kind === "tag")).toHaveLength(6);
    expect(sheets[0][29]).toEqual({ kind: "tag", index: 5 });
    expect(sheets[1][0]).toEqual({ kind: "tag", index: 6 });
    // Only the first sheet is partly used; the next starts at its label 1.
    expect(sheets[1].filter((s) => s.kind === "used")).toHaveLength(0);
    expect(sheets[1].filter((s) => s.kind === "tag")).toHaveLength(24);
    expect(sheets[1].filter((s) => s.kind === "blank")).toHaveLength(6);
  });

  it("counts the tags on the last sheet", () => {
    const sheets = sheetSlots(75, 1);
    expect(sheets).toHaveLength(3);
    expect(sheets[2].filter((s) => s.kind === "tag")).toHaveLength(15);
    expect(sheets[2].filter((s) => s.kind === "blank")).toHaveLength(15);
    expect(sheetSlots(30, 1)).toHaveLength(1);
    expect(sheetSlots(31, 1)).toHaveLength(2);
    expect(sheetSlots(1, 30)).toHaveLength(1);
    expect(sheetSlots(2, 30)).toHaveLength(2);
  });

  it("clamps the start label to 1..30", () => {
    expect(kinds(sheetSlots(1, 0)[0])[0]).toBe("tag");
    expect(kinds(sheetSlots(1, -4)[0])[0]).toBe("tag");
    expect(sheetSlots(1, 99)[0][29]).toEqual({ kind: "tag", index: 0 });
    expect(clampStart(Number.NaN)).toBe(1);
    expect(clampStart(7.8)).toBe(7);
  });
});

describe("nextStart", () => {
  it("is the label after the last one printed", () => {
    expect(nextStart(1, 12)).toBe(13);
    expect(nextStart(13, 5)).toBe(18);
  });

  it("wraps after label 30", () => {
    expect(nextStart(25, 6)).toBe(1);
    expect(nextStart(25, 7)).toBe(2);
    expect(nextStart(1, 30)).toBe(1);
    expect(nextStart(1, 65)).toBe(6);
  });

  it("stays put for no tags and clamps a bad start", () => {
    expect(nextStart(13, 0)).toBe(13);
    expect(nextStart(0, 1)).toBe(2);
    expect(nextStart(40, 1)).toBe(1);
  });
});
