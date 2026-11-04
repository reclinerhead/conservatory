// The home page's species grid, pure: the place chips, which species a chip
// and the search leave on screen and in what order, and what each tile's
// meta line says. The server reads the rows once (speciesList in
// lib/species.ts); the client (components/species-grid.tsx) runs these on
// every keystroke and every chip, so filtering never leaves the phone.

import { GONE, NO_LOCATION, type Chip } from "./collection";
import { matchesSpecies, speciesTitle, type SpeciesListRow } from "./species-page";

export const ALL = "all";

/** The grid's orders, as the Sort by select lists them; the first is the default. */
export type Sort = "name" | "latest";
export const SORTS: Array<{ key: Sort; label: string }> = [
  { key: "name", label: "Name, A to Z" },
  { key: "latest", label: "Latest added" },
];

/** A stored or typed sort, read safely: anything not on the list is the default. */
export function readSort(v: string | null | undefined): Sort {
  return SORTS.some((s) => s.key === v) ? (v as Sort) : "name";
}

type Row = Pick<SpeciesListRow, "specimens" | "places" | "gone">;

/** How many of a species' plants a chip stands for: living ones at "All" or at a place, gifted or died ones at "No longer here". */
export function countAt(r: Row, at: string): number {
  if (at === ALL) return r.specimens;
  if (at === GONE.key) return r.gone;
  const want = at === NO_LOCATION.key ? null : at;
  return r.places.find((p) => p.at === want)?.n ?? 0;
}

/**
 * The filter row: "All" with every species that has a living plant, then
 * each place A to Z with the species that have a living plant there, then
 * "No location yet" and "No longer here" only when someone is in them. A
 * species in two places counts under both. Counts come from the whole list,
 * never the search, so the row keeps its shape while a person types.
 */
export function placeChips(rows: Row[]): Chip[] {
  const named = new Map<string, number>();
  let living = 0;
  let none = 0;
  let gone = 0;
  for (const r of rows) {
    if (r.specimens > 0) living++;
    if (r.gone > 0) gone++;
    for (const p of r.places) {
      if (p.n <= 0) continue;
      if (p.at === null) none++;
      else named.set(p.at, (named.get(p.at) ?? 0) + 1);
    }
  }
  const places = [...named]
    .sort(([a], [b]) => a.localeCompare(b, "en", { sensitivity: "base" }))
    .map(([at, n]) => ({ key: at, label: at, n }));
  return [
    { key: ALL, label: "All", n: living },
    ...places,
    ...(none > 0 ? [{ key: NO_LOCATION.key, label: NO_LOCATION.label, n: none }] : []),
    ...(gone > 0 ? [{ key: GONE.key, label: GONE.label, n: gone }] : []),
  ];
}

/** The chip a `?at=` value selects; "all" when it names no chip on the row. */
export function selectedPlace(chips: Chip[], param: string | null): string {
  return chips.some((c) => c.key === param) ? (param as string) : ALL;
}

/**
 * The species a chip and the search leave on screen, in the chosen order:
 * by the name the tile shows, A to Z, then id; or "latest", by when each
 * species' newest plant was added, newest first, then by name.
 */
export function gridRows<T extends SpeciesListRow>(rows: T[], opts: { q?: string; at?: string; sort?: Sort } = {}): T[] {
  const at = opts.at ?? ALL;
  const q = opts.q ?? "";
  const byName = (a: T, b: T) => speciesTitle(a).localeCompare(speciesTitle(b), "en", { sensitivity: "base" }) || a.id - b.id;
  const byLatest = (a: T, b: T) => {
    const la = a.latest ?? "";
    const lb = b.latest ?? "";
    return la === lb ? byName(a, b) : la < lb ? 1 : -1;
  };
  return rows.filter((r) => countAt(r, at) > 0 && matchesSpecies(r, q)).sort(opts.sort === "latest" ? byLatest : byName);
}

function plants(n: number): string {
  return n === 1 ? "1 plant" : `${n} plants`;
}

/**
 * A tile's meta line, for the chip on screen. At "All": "3 plants · 2
 * places", or the place's name when every living plant is in the one place,
 * or the count alone when none has a location. At a place, or at "No
 * location yet": "1 plant here", or "2 of 3 plants here" when the rest live
 * elsewhere (the chip already names the place). At "No longer here": "1
 * plant no longer here".
 */
export function tileLine(r: Row, at: string): string {
  if (at === GONE.key) return `${plants(r.gone)} no longer here`;
  if (at !== ALL) {
    const n = countAt(r, at);
    return n === r.specimens ? `${plants(n)} here` : `${n} of ${plants(r.specimens)} here`;
  }
  const named = r.places.filter((p) => p.at !== null && p.n > 0);
  const unplaced = r.places.some((p) => p.at === null && p.n > 0);
  if (named.length === 0) return plants(r.specimens);
  if (named.length === 1 && !unplaced) return `${plants(r.specimens)} · ${named[0].at}`;
  return `${plants(r.specimens)} · ${named.length === 1 ? "1 place" : `${named.length} places`}`;
}

/** "Showing all 12 species", "Showing 3 of 12 species", against the count on the chip on screen. */
export function showingSpecies(shown: number, total: number): string {
  if (total === 0) return "Nothing to show yet";
  if (shown === total) return total === 1 ? "Showing 1 species" : `Showing all ${total} species`;
  return `Showing ${shown} of ${total} species`;
}
