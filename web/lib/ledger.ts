import type { CollectionCounts } from "./db";

/** "3 plants", "1 species", "0 locations": a count with its noun. */
export function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** The life list's counts line (DESIGN.md §5): "42 specimens · 31 species · 6 locations". */
export function ledgerEntries(c: CollectionCounts): string[] {
  return [count(c.specimens, "specimen"), count(c.species, "species", "species"), count(c.places, "location")];
}

/** The pending strip's headline. Same length class in every state so the strip never moves. */
export function waitingLabel(n: number): string {
  if (n <= 0) return "Nothing waiting for a name";
  return `${count(n, "plant")} waiting for a name`;
}

/** The pending strip's second line. */
export function waitingDetail(n: number): string {
  if (n <= 0) return "Add a photo and Fern will have a guess ready in a few seconds.";
  if (n === 1) return "Fern has a suggestion ready.";
  return `Fern has suggestions ready for all ${n === 2 ? "two" : n === 3 ? "three" : n}.`;
}
