// The collection grid's shape, pure: what a tile says, how tiles are searched,
// grouped by location and ordered within a group. The server reads the rows
// (lib/specimens.ts); the client (components/collection.tsx) filters and
// groups them here on every keystroke, so a search over 150 plants never
// leaves the phone.

export type SpecimenStatus = "alive" | "gifted" | "died";

export type Tile = {
  id: number;
  nickname: string | null;
  scientificName: string;
  cultivar: string | null;
  location: string | null;
  acquiredOn: string | null; // ISO date
  status: SpecimenStatus;
  createdAt: string; // ISO datetime
  thumbUrl: string | null; // the newest photo's 320 px thumbnail
};

export type Group = { key: string; label: string; tiles: Tile[] };
export type Chip = { key: string; label: string; n: number };

/** The group of plants with no location yet, and the one for plants no longer here. */
export const NO_LOCATION = { key: "none", label: "No location yet" } as const;
export const GONE = { key: "gone", label: "No longer here" } as const;

export const STATUS_LABEL: Record<SpecimenStatus, string> = { alive: "Alive", gifted: "Gifted away", died: "Died" };

/** The five tile greens for a plant without a photo (DESIGN.md §2): vary between neighbours. */
export const TILE_TINTS = ["bg-tile-1", "bg-tile-2", "bg-tile-3", "bg-tile-4", "bg-tile-5"];

/** "Ficus elastica 'Ruby'": the species with its cultivar in single quotes, as a grower writes it. */
export function speciesLabel(scientificName: string, cultivar: string | null): string {
  return cultivar ? `${scientificName} '${cultivar}'` : scientificName;
}

/** What a tile is called: the nickname when there is one, else the species. */
export function tileName(t: Pick<Tile, "nickname" | "scientificName" | "cultivar">): string {
  return t.nickname ?? speciesLabel(t.scientificName, t.cultivar);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "May 2019" from an ISO date or datetime; null when it is not one. Read from the string, never through a time zone. */
export function monthYear(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(iso ?? "");
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${m[1]}` : null;
}

/** "Oct 31, 2026" from an ISO date or datetime; null when it is not one. */
export function dayLabel(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : null;
}

/** The card's meta line: "Front bed · since May 2019", or "added Oct 2026" when no acquired date is known. */
export function metaLine(t: Pick<Tile, "location" | "acquiredOn" | "createdAt">): string {
  const since = monthYear(t.acquiredOn);
  const when = since ? `since ${since}` : `added ${monthYear(t.createdAt) ?? "recently"}`;
  return t.location ? `${t.location} · ${when}` : when;
}

/** Does the search box's text match this tile? Nickname or species name, case-insensitive, any part. */
export function matchesQuery(t: Pick<Tile, "nickname" | "scientificName" | "cultivar">, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (t.nickname ?? "").toLowerCase().includes(needle) || speciesLabel(t.scientificName, t.cultivar).toLowerCase().includes(needle);
}

function groupKey(t: Tile): string {
  if (t.status !== "alive") return GONE.key;
  return t.location ?? NO_LOCATION.key;
}

function groupLabel(key: string): string {
  if (key === GONE.key) return GONE.label;
  if (key === NO_LOCATION.key) return NO_LOCATION.label;
  return key;
}

/** Named locations A to Z, then the plants with none, then the plants no longer here. */
function compareKeys(a: string, b: string): number {
  const rank = (k: string) => (k === GONE.key ? 2 : k === NO_LOCATION.key ? 1 : 0);
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  return a.localeCompare(b, "en", { sensitivity: "base" });
}

/** Newest first: by when the specimen was created, then by id, so two in the same second keep a stable order. */
function newestFirst(a: Tile, b: Tile): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return b.id - a.id;
}

/**
 * The grid: tiles that match the search, grouped by location, groups and
 * tiles in their standing order. `where` is "all", a location, NO_LOCATION.key
 * or GONE.key. Empty groups are dropped, so a search can leave no groups.
 */
export function groupTiles(tiles: Tile[], opts: { q?: string; where?: string } = {}): Group[] {
  const q = opts.q ?? "";
  const where = opts.where ?? "all";
  const byKey = new Map<string, Tile[]>();
  for (const t of tiles) {
    if (!matchesQuery(t, q)) continue;
    const key = groupKey(t);
    if (where !== "all" && key !== where) continue;
    const list = byKey.get(key) ?? [];
    list.push(t);
    byKey.set(key, list);
  }
  return [...byKey.keys()].sort(compareKeys).map((key) => ({
    key,
    label: groupLabel(key),
    tiles: byKey.get(key)!.sort(newestFirst),
  }));
}

/**
 * The filter row: "All" with every plant, one chip per location in the
 * grid's order, then "No location yet" and "No longer here" only when they
 * have anyone in them. Counts come from the whole collection, not the
 * search, so the row never changes shape while a person types.
 */
export function locationChips(tiles: Tile[]): Chip[] {
  const groups = groupTiles(tiles);
  return [{ key: "all", label: "All", n: tiles.length }, ...groups.map((g) => ({ key: g.key, label: g.label, n: g.tiles.length }))];
}

/** "Showing 9 of 42", or "Showing all 42" when nothing is filtered out. */
export function showingLine(shown: number, total: number): string {
  if (total === 0) return "Nothing to show yet";
  return shown === total ? `Showing all ${total}` : `Showing ${shown} of ${total}`;
}
