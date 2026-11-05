// The dashboard's side column (DESIGN.md §5), pure: which species "New
// species added recently" lists, and how many families "Your collection at a
// glance" counts. The server hands in the species list's rows
// (lib/species.ts), the ones the grid draws, so the card's thumbnails follow
// the tile's rule with no query of their own.

import { taxonKey } from "./relatives";
import type { SpeciesListRow } from "./species-page";

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

/**
 * How many families the household's living plants span, each matched as the
 * relatives block matches it. A species GBIF has not placed has no family
 * and adds nothing.
 */
export function familyCount(rows: Pick<SpeciesListRow, "family" | "specimens">[]): number {
  return new Set(rows.filter((r) => r.specimens > 0).map((r) => taxonKey(r.family)).filter(Boolean)).size;
}
