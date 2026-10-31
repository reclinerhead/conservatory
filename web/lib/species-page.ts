// The species page and the species list, pure: what a species is called, its
// breadcrumb, the order of its gallery, what the About card says before and
// after Fern has looked it up, and how the list is sorted and searched. The
// server reads the rows (lib/species.ts); the pages render what this decides.

import { dayLabel, speciesLabel, type Tile } from "./collection";
import { percent } from "./pills";
import { thumbPathFor } from "./photos";

/** GBIF's vernacular names arrive in any case ("echeveria", "India Rubber Fig"); a title starts with a capital. */
export function displayName(commonName: string | null | undefined): string | null {
  const t = (commonName ?? "").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : null;
}

/** What a species is called: its common name when Fern found one, else the scientific name with any cultivar. */
export function speciesTitle(s: { commonName: string | null; scientificName: string; cultivar: string | null }): string {
  return displayName(s.commonName) ?? speciesLabel(s.scientificName, s.cultivar);
}

export type Crumb = { label: string; href?: string; italic?: boolean; current?: boolean };

/**
 * Collection › Family › Genus › this species. A rank Fern has not filled is
 * skipped, never faked, and the genus is skipped for a species that is
 * itself a genus (an Echeveria with a nursery tag). Family and genus link to
 * the species list searched for them, which is the nearest thing to a page
 * for a family until there is one.
 */
export function speciesCrumbs(s: {
  family: string | null;
  genus: string | null;
  rank: string | null;
  commonName: string | null;
  scientificName: string;
  cultivar: string | null;
}): Crumb[] {
  const crumbs: Crumb[] = [{ label: "Collection", href: "/" }];
  if (s.family) crumbs.push({ label: s.family, href: `/species?q=${encodeURIComponent(s.family)}` });
  if (s.genus && s.rank !== "genus") crumbs.push({ label: s.genus, href: `/species?q=${encodeURIComponent(s.genus)}`, italic: true });
  crumbs.push({ label: speciesTitle(s), italic: !displayName(s.commonName), current: true });
  return crumbs;
}

export type OwnerPhoto = {
  photoId: number;
  specimenId: number;
  specimenName: string;
  path: string; // relative to CONSERVATORY_DATA
  takenAt: string | null;
  uploadedAt: string;
};

export type Reference = { url: string; thumbUrl: string; credit: string | null; sourceUrl: string | null };

export type GalleryItem = {
  kind: "owner" | "reference";
  key: string;
  url: string; // the full image
  thumbUrl: string;
  href: string; // where a tap goes: the specimen's page, or the image's page on Commons
  caption: string; // the pill on a large figure
  short: string; // the bar on a small one
  alt: string;
};

const when = (p: OwnerPhoto) => p.takenAt ?? p.uploadedAt;

/**
 * The gallery, in order: the newest photo of each specimen of this species,
 * newest first, then the reference image. Owner photos always outrank the
 * reference, so the reference is the hero only when the household has no
 * photo of this species yet.
 */
export function speciesGallery(photos: OwnerPhoto[], ref: Reference | null): GalleryItem[] {
  const newest = [...photos].sort((a, b) => (when(a) !== when(b) ? (when(a) < when(b) ? 1 : -1) : b.photoId - a.photoId));
  const seen = new Set<number>();
  const items: GalleryItem[] = [];
  for (const p of newest) {
    if (seen.has(p.specimenId)) continue;
    seen.add(p.specimenId);
    items.push({
      kind: "owner",
      key: `photo-${p.photoId}`,
      url: `/media/${p.path}`,
      thumbUrl: `/media/${thumbPathFor(p.path)}`,
      href: `/plants/${p.specimenId}`,
      caption: `Your photo · ${p.specimenName} · ${dayLabel(when(p)) ?? "date unknown"}`,
      short: p.specimenName,
      alt: `Your photo of ${p.specimenName}`,
    });
  }
  if (ref) {
    items.push({
      kind: "reference",
      key: "reference",
      url: ref.url,
      thumbUrl: ref.thumbUrl,
      href: ref.sourceUrl ?? ref.url,
      caption: ref.credit ? `Reference · ${ref.credit}` : "Reference · Wikipedia",
      short: "Wikipedia",
      alt: "Reference image from Wikipedia",
    });
  }
  return items;
}

/** "2 of your photos · 1 reference image", under the gallery. */
export function galleryLine(ownerPhotos: number, hasReference: boolean): string {
  const own = ownerPhotos === 0 ? "No photos of yours yet" : `${ownerPhotos} of your photos`;
  return hasReference ? `${own} · 1 reference image` : own;
}

export type AboutState =
  | { kind: "summary"; paragraphs: string[] }
  | { kind: "pending" }
  | { kind: "no-page"; unknownToGbif: boolean };

/** What the About card can say: the summary, "not looked up yet", or "Wikipedia has no page". */
export function aboutState(s: { enrichedAt: string | null; summary: string | null; gbifKey: number | null }): AboutState {
  const paragraphs = (s.summary ?? "")
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length > 0) return { kind: "summary", paragraphs };
  if (!s.enrichedAt) return { kind: "pending" };
  return { kind: "no-page", unknownToGbif: s.gbifKey === null };
}

/**
 * A summary paragraph cut where the species' own Latin names appear, so the
 * page can set them in italics as DESIGN.md asks (Wikipedia's plain text has
 * lost its markup). Whole words only, longest name first, so "Ficus elastica"
 * is one run rather than "Ficus" and then "elastica".
 */
export function latinRuns(text: string, names: Array<string | null | undefined>): Array<{ text: string; latin: boolean }> {
  const wanted = [...new Set(names.map((n) => (n ?? "").trim()).filter((n) => n.length > 2))].sort((a, b) => b.length - a.length);
  if (wanted.length === 0) return [{ text, latin: false }];
  const escaped = wanted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`\\b(${escaped.join("|")})\\b`, "g");
  const runs: Array<{ text: string; latin: boolean }> = [];
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > at) runs.push({ text: text.slice(at, m.index), latin: false });
    runs.push({ text: m[0], latin: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) runs.push({ text: text.slice(at), latin: false });
  return runs;
}

/** "1 specimen", "3 specimens", "None living". */
export function specimenCount(n: number): string {
  if (n === 0) return "None living";
  return n === 1 ? "1 specimen" : `${n} specimens`;
}

/** The In your collection header: "3 specimens · 2 locations", plus any no longer here. */
export function inCollectionLine(tiles: Pick<Tile, "status" | "location">[]): string {
  const living = tiles.filter((t) => t.status === "alive");
  const places = new Set(living.map((t) => t.location).filter(Boolean)).size;
  const gone = tiles.length - living.length;
  const parts = [specimenCount(living.length)];
  if (places > 0) parts.push(places === 1 ? "1 location" : `${places} locations`);
  if (gone > 0) parts.push(`${gone} no longer here`);
  return parts.join(" · ");
}

export type Naming = { how: "pill" | "typed" | "same"; score: number | null; at: string } | null;

/** How the species came into the collection, under the taxonomy card. */
export function namingLine(n: Naming): string | null {
  if (!n) return null;
  const day = dayLabel(n.at) ?? "";
  if (n.how === "pill" && n.score !== null) return `Identified by Fern via Pl@ntNet at ${percent(n.score)} · confirmed by you ${day}`;
  if (n.how === "pill") return `Picked from Fern's suggestions on ${day}`;
  if (n.how === "typed") return `You typed this name on ${day}`;
  return `Named on ${day}`;
}

export type SpeciesListRow = {
  id: number;
  scientificName: string;
  cultivar: string | null;
  commonName: string | null;
  canonicalName: string | null;
  family: string | null;
  genus: string | null;
  specimens: number; // living
  thumbUrl: string | null; // an owner photo's thumbnail first, else the reference's, else none
};

/** Most owned first, then by what the species is called, A to Z. */
export function compareSpecies(a: SpeciesListRow, b: SpeciesListRow): number {
  if (a.specimens !== b.specimens) return b.specimens - a.specimens;
  const byName = speciesTitle(a).localeCompare(speciesTitle(b), "en", { sensitivity: "base" });
  return byName !== 0 ? byName : a.id - b.id;
}

/** The top bar's search over the species list: common name, scientific name with cultivar, GBIF's spelling, genus or family, any part, any case. */
export function matchesSpecies(r: SpeciesListRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [r.commonName, speciesLabel(r.scientificName, r.cultivar), r.canonicalName, r.genus, r.family].some((v) =>
    (v ?? "").toLowerCase().includes(needle),
  );
}

export type FamilyChip = { key: string; label: string; n: number };

/**
 * The species list's family filter: "All", then one chip per family A to Z,
 * each counted from the whole list so the row keeps its shape while a person
 * types. A species not placed in a family yet counts under All only.
 */
export function familyChips(rows: Pick<SpeciesListRow, "family">[]): FamilyChip[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const f = (r.family ?? "").trim();
    if (f) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  const families = [...counts]
    .sort(([a], [b]) => a.localeCompare(b, "en", { sensitivity: "base" }))
    .map(([f, n]) => ({ key: f, label: f, n }));
  return [{ key: "all", label: "All", n: rows.length }, ...families];
}

/** The chip a `?family=` value selects, matched without regard to case; "all" when it names no family on the list. */
export function selectedFamily(chips: FamilyChip[], param: string | null): string {
  const want = (param ?? "").trim().toLowerCase();
  return chips.find((c) => c.key !== "all" && c.key.toLowerCase() === want)?.key ?? "all";
}

/** Whether a row is in the selected family. */
export function inFamily(r: Pick<SpeciesListRow, "family">, family: string): boolean {
  return family === "all" || (r.family ?? "").trim() === family;
}

/** "2 species · 2 families" over the list. */
export function speciesLedger(rows: Pick<SpeciesListRow, "family">[]): string {
  const families = new Set(rows.map((r) => r.family).filter(Boolean)).size;
  return `${rows.length} species · ${families === 1 ? "1 family" : `${families} families`}`;
}
