// The dashboard's side column (DESIGN.md §5), pure: which species "New
// species added recently" lists, how the collection splits by family for
// "What you grow most" (whose length is the at-a-glance families tile, so the
// two never disagree), and which species
// "Get to know" shows today. The server hands in the species list's rows
// (lib/species.ts), the ones the grid draws, so the cards' thumbnails follow
// the tile's rule with no query of their own.

import { taxonKey } from "./relatives";
import { speciesTitle, type SpeciesListRow } from "./species-page";

const byText = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" });

/**
 * The species that joined the collection most recently, newest first, at
 * most `limit`. A species joins when its name is first confirmed (`addedAt`),
 * so a second pot of one already owned does not bring it back up; new plants
 * are the grid's Latest added sort. Ties go to the newer id. Only species
 * with a living plant.
 */
export function recentSpecies<T extends Pick<SpeciesListRow, "id" | "addedAt" | "specimens">>(rows: T[], limit: number): T[] {
  return rows
    .filter((r) => r.specimens > 0)
    .sort((a, b) => (a.addedAt === b.addedAt ? b.id - a.id : a.addedAt < b.addedAt ? 1 : -1))
    .slice(0, limit);
}

export type FamilyRow = {
  name: string; // the spelling most of its species carry
  species: number; // species with a living plant
  genera: string[]; // the genera owned in it, A to Z
};

/**
 * The household's living species by family, most species first, then by
 * name. Families match as the relatives block matches them (case and stray
 * spaces ignored); where spellings differ, a family is shown by the one most
 * of its species carry, ties to the first species A to Z. A species GBIF has
 * not placed has no family and is counted in `unplaced` instead.
 */
export function familyTally(rows: SpeciesListRow[]): { families: FamilyRow[]; unplaced: number } {
  const living = rows.filter((r) => r.specimens > 0).sort((a, b) => byText(speciesTitle(a), speciesTitle(b)) || a.id - b.id);
  const groups = new Map<string, SpeciesListRow[]>();
  let unplaced = 0;
  for (const r of living) {
    const key = taxonKey(r.family);
    if (!key) {
      unplaced++;
      continue;
    }
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const families = [...groups.values()].map((members) => {
    const spellings = new Map<string, number>();
    for (const m of members) {
      const s = (m.family ?? "").trim();
      spellings.set(s, (spellings.get(s) ?? 0) + 1);
    }
    // Map keeps first-seen order, and members are A to Z, so the first
    // spelling with the top count is the first species' among the tied.
    const top = Math.max(...spellings.values());
    const name = [...spellings].find(([, n]) => n === top)![0];
    const genera = new Map<string, string>();
    for (const m of members) {
      const g = (m.genus ?? "").trim();
      if (g && !genera.has(taxonKey(g))) genera.set(taxonKey(g), g);
    }
    return { name, species: members.length, genera: [...genera.values()].sort(byText) };
  });
  families.sort((a, b) => b.species - a.species || byText(a.name, b.name));
  return { families, unplaced };
}

/** A family's genera line, "Aeonium, Dudleya, Echeveria +2 more": the first `shown` names, then how many are left. */
export function generaShown(genera: string[], shown = 3): { names: string[]; more: number } {
  return { names: genera.slice(0, shown), more: Math.max(0, genera.length - shown) };
}

/**
 * A family's bar, in twelfths of the card's width: its species against the
 * top family's, rounded, never less than one twelfth so every family shows.
 */
export function barTwelfths(species: number, top: number): number {
  if (top <= 0) return 0;
  return Math.min(12, Math.max(1, Math.round((12 * species) / top)));
}

/** A fixed shuffle of species ids: the same order every day, but not the order they were added in. */
function idHash(id: number): number {
  let h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Whole days since 1970-01-01 on the station's own calendar, so the day turns at local midnight. */
export function localDay(now: Date): number {
  return Math.floor((now.getTime() - now.getTimezoneOffset() * 60_000) / 86_400_000);
}

/**
 * Today's species for "Get to know": one with a living plant and a stored
 * Wikipedia summary. The eligible species stand in a fixed shuffled order
 * and the day picks the next one along, so the pick holds all day, moves on
 * at midnight, and every eligible species has its day before any comes
 * round again. A new species can change that day's pick. Null when none is
 * eligible.
 */
export function spotlightPick<T extends Pick<SpeciesListRow, "id" | "specimens" | "hasSummary">>(rows: T[], now: Date): T | null {
  const eligible = rows.filter((r) => r.specimens > 0 && r.hasSummary).sort((a, b) => idHash(a.id) - idHash(b.id) || a.id - b.id);
  if (eligible.length === 0) return null;
  const n = eligible.length;
  return eligible[((localDay(now) % n) + n) % n];
}
