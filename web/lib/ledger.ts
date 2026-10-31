import type { CollectionCounts } from "./db";

/** "3 plants", "1 species", "0 places": the masthead's ledger entries. */
export function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

export function ledgerEntries(c: CollectionCounts): string[] {
  return [count(c.specimens, "plant"), count(c.species, "species", "species"), count(c.places, "place")];
}

/** The strip's one line. Same length class in every state so the strip never moves. */
export function waitingLabel(n: number): string {
  if (n <= 0) return "Nothing waiting for a name";
  return `${count(n, "plant")} waiting for a name`;
}
