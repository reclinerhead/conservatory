import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GLOSSARY } from "./glossary";

/** Every `<Term k="...">` in the UI. */
function usedKeys(dir: string, acc: Set<string> = new Set()): Set<string> {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) usedKeys(p, acc);
    else if (/\.tsx$/.test(name)) {
      const src = readFileSync(p, "utf8");
      for (const m of src.matchAll(/<Term\s+k="([^"]+)"/g)) acc.add(m[1]);
    }
  }
  return acc;
}

describe("glossary", () => {
  it("has an entry for every term the UI marks", () => {
    const root = path.resolve(__dirname, "..");
    const used = new Set<string>();
    for (const d of ["app", "components"]) usedKeys(path.join(root, d), used);
    for (const k of used) expect(Object.keys(GLOSSARY), `missing glossary entry for "${k}"`).toContain(k);
  });

  it("keeps every entry to a short paragraph with a sentence or three", () => {
    for (const [k, e] of Object.entries(GLOSSARY)) {
      expect(e.text.length, k).toBeLessThanOrEqual(380);
      const sentences = e.text.split(/[.!?](\s|$)/).filter((s) => s.trim().length > 0).length;
      expect(sentences, k).toBeGreaterThanOrEqual(2);
      expect(sentences, k).toBeLessThanOrEqual(3);
      if (e.more) expect(e.more).toMatch(/^https:\/\//);
    }
  });
});
