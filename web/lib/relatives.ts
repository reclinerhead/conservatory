// "Relatives you already have", pure: the other species in the household that
// share this one's genus, then those that share its family under another
// genus. Taxonomy only. Which pot came from which (lineage) is a different
// relationship and lives elsewhere. Relatives are species the household owns
// now, so a species with nothing left alive is not one. The server hands in
// the species list's rows (lib/species.ts); this decides who is related.

import { compareSpecies, type SpeciesListRow } from "./species-page";

export type Relatives =
  | { placed: false }
  | { placed: true; genus: string; family: string; sameGenus: SpeciesListRow[]; sameFamily: SpeciesListRow[] };

const same = (a: string | null, b: string) => (a ?? "").trim().toLowerCase() === b.trim().toLowerCase();

/**
 * This species' relatives among `rows`. Same genus first, then same family
 * but a different genus, each most owned first, then by name. A species
 * without both a genus and a family is not placed yet, and has no relatives
 * to show; a placed species with none gets empty groups, never null.
 */
export function relativesOf(self: { id: number; genus: string | null; family: string | null }, rows: SpeciesListRow[]): Relatives {
  const genus = (self.genus ?? "").trim();
  const family = (self.family ?? "").trim();
  if (!genus || !family) return { placed: false };
  const others = rows.filter((r) => r.id !== self.id && r.specimens > 0);
  const sameGenus = others.filter((r) => same(r.genus, genus)).sort(compareSpecies);
  const sameFamily = others.filter((r) => !same(r.genus, genus) && same(r.family, family)).sort(compareSpecies);
  return { placed: true, genus, family, sameGenus, sameFamily };
}

/** How many species the household owns that are related to this one; 0 when it is not placed. */
export function relativeCount(r: Relatives): number {
  return r.placed ? r.sameGenus.length + r.sameFamily.length : 0;
}

const binomial = (s: { canonicalName: string | null; scientificName: string }) => s.canonicalName ?? s.scientificName;

/** A list in prose: "A", "A and B", "A, B and C". */
function prose(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The genus mark's example, from the plants on screen: "Ficus elastica and Ficus lyrata are both Ficus." */
export function genusExample(self: { canonicalName: string | null; scientificName: string }, r: Relatives): string | undefined {
  if (!r.placed) return undefined;
  const others = [...new Set(r.sameGenus.map(binomial))].filter((n) => n !== binomial(self)).slice(0, 2);
  if (others.length === 0) return `${binomial(self)} is the only ${r.genus} you have so far.`;
  const names = [binomial(self), ...others];
  return `${prose(names)} are ${names.length === 2 ? "both" : "all"} ${r.genus}.`;
}

/** The family mark's example, from the plants on screen: "Echeveria, Sedum and Crassula are different genera, all Crassulaceae." */
export function familyExample(r: Relatives): string | undefined {
  if (!r.placed) return undefined;
  const genera = [r.genus];
  for (const s of r.sameFamily) {
    const g = (s.genus ?? "").trim();
    if (g && !genera.some((x) => same(x, g))) genera.push(g);
    if (genera.length === 3) break;
  }
  if (genera.length === 1) return `${r.genus} is the only genus of ${r.family} you have so far.`;
  return `${prose(genera)} are different genera, ${genera.length === 2 ? "both" : "all"} ${r.family}.`;
}

/** The specimen page's sentence about its species' relatives. */
export function relativesLine(r: Relatives): string {
  if (!r.placed) return "Its relatives show once Fern has placed it in a genus and a family.";
  const n = relativeCount(r);
  if (n === 0) return "Nothing else you own shares its genus or family yet.";
  return n === 1 ? "Related to 1 other species you own." : `Related to ${n} other species you own.`;
}
