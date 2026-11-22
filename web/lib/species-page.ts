// The species page and the species list, pure: what a species is called, its
// breadcrumb, the order of its gallery, what the About card says before and
// after Fern has looked it up, and how the list is sorted and searched. The
// server reads the rows (lib/species.ts); the pages render what this decides.

import { BASE_PATH } from "./base-path";
import { dayLabel, displayName, speciesLabel, type SpecimenStatus, type Tile } from "./collection";
import { percent } from "./pills";
import { thumbPathFor } from "./photos";

/** What a species is called: its common name when Fern found one, else the scientific name with any cultivar. */
export function speciesTitle(s: { commonName: string | null; scientificName: string; cultivar: string | null }): string {
  return displayName(s.commonName) ?? speciesLabel(s.scientificName, s.cultivar);
}

export type Crumb = { label: string; href?: string; italic?: boolean; current?: boolean };

/**
 * Collection › Family › Genus › this species. A rank Fern has not filled is
 * skipped, never faked, and the genus is skipped for a species that is
 * itself a genus (an Echeveria with a nursery tag). Family and genus link to
 * the collection searched for them, which is the nearest thing to a page
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
  if (s.family) crumbs.push({ label: s.family, href: `/?q=${encodeURIComponent(s.family)}` });
  if (s.genus && s.rank !== "genus") crumbs.push({ label: s.genus, href: `/?q=${encodeURIComponent(s.genus)}`, italic: true });
  crumbs.push({ label: speciesTitle(s), italic: !displayName(s.commonName), current: true });
  return crumbs;
}

export type OwnerPhoto = {
  photoId: number;
  specimenId: number;
  path: string; // relative to CONSERVATORY_DATA
  takenAt: string | null;
  uploadedAt: string;
  chosen: boolean; // chosen on its plant's page as the photo the plant is known by (#46)
};

export type Reference = { url: string; thumbUrl: string; credit: string | null; sourceUrl: string | null };

export type GalleryItem = {
  kind: "owner" | "reference";
  key: string;
  photoId?: number; // an owner photo's id, which can be made the species photo
  specimenId?: number; // an owner photo's plant
  at?: string; // when an owner photo was taken (its upload when the EXIF had no date); ISO
  url: string; // the full image
  thumbUrl: string;
  href: string; // where a tap goes: the specimen's page, or the image's page on Commons
  caption: string; // the pill on the hero, and under the slide in the lightbox
  alt: string;
};

const when = (p: OwnerPhoto) => p.takenAt ?? p.uploadedAt;

/** Newest first by when the photo was taken (its upload when the EXIF had no date), then the newer id. */
const newestFirst = (a: OwnerPhoto, b: OwnerPhoto) => (when(a) !== when(b) ? (when(a) < when(b) ? 1 : -1) : b.photoId - a.photoId);

/** "Plant #281": what one plant of a species is called on the species page, where every plant shares the species' name. */
export function plantLabel(specimenId: number): string {
  return `Plant #${specimenId}`;
}

/**
 * Every photo of the species, in the lightbox's order: the species photo
 * first, then every other photo of every plant, newest first across plants,
 * then the reference image. The film strip is the same photos with the
 * species photo back in its date position (filmStrip).
 *
 * The species photo (#77) is the one chosen on this page, `chosenId`, while
 * it is still a photo of one of the species' plants; else the newest of the
 * plants' main photos (#46: the one chosen on a plant's page, else its
 * newest), the same rule as speciesList's thumbnail. It is never repeated
 * after itself.
 *
 * Owner photos always outrank the reference, so the reference leads only
 * when the household has no photo of this species yet.
 */
export function speciesGallery(photos: OwnerPhoto[], ref: Reference | null, chosenId: number | null = null): GalleryItem[] {
  const all = [...photos].sort(newestFirst);
  const main = new Map<number, OwnerPhoto>();
  for (const p of all) {
    const held = main.get(p.specimenId);
    if (!held || (p.chosen && !held.chosen)) main.set(p.specimenId, p);
  }
  const lead = (chosenId === null ? undefined : all.find((p) => p.photoId === chosenId)) ?? [...main.values()].sort(newestFirst)[0];
  const items: GalleryItem[] = [];
  for (const p of lead ? [lead, ...all.filter((m) => m.photoId !== lead.photoId)] : all) {
    items.push({
      kind: "owner",
      key: `photo-${p.photoId}`,
      photoId: p.photoId,
      specimenId: p.specimenId,
      at: when(p),
      url: `${BASE_PATH}/media/${p.path}`,
      thumbUrl: `${BASE_PATH}/media/${thumbPathFor(p.path)}`,
      href: `/plants/${p.specimenId}`,
      caption: `Your photo · ${plantLabel(p.specimenId)} · ${dayLabel(when(p)) ?? "date unknown"}`,
      alt: `Your photo of plant #${p.specimenId}`,
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
      alt: "Reference image from Wikipedia",
    });
  }
  return items;
}

/** The film strip's order: the gallery with the species photo back in its date position, so the strip is the whole timeline, newest first, the reference last. */
export function filmStrip(gallery: GalleryItem[]): GalleryItem[] {
  const owner = gallery.filter((g) => g.kind === "owner");
  const byDate = (a: GalleryItem, b: GalleryItem) => (a.at !== b.at ? ((a.at ?? "") < (b.at ?? "") ? 1 : -1) : (b.photoId ?? 0) - (a.photoId ?? 0));
  return [...owner.sort(byDate), ...gallery.filter((g) => g.kind !== "owner")];
}

/**
 * Under a photo in the film strip: "#281 · Nov 20", with the year when it is
 * not this one ("#281 · May 20, 2025"), and "Wikipedia" under the reference.
 * `today` is an ISO date, passed in so this reads no clock.
 */
export function stripCaption(g: Pick<GalleryItem, "kind" | "specimenId" | "at">, today: string): string {
  if (g.kind === "reference") return "Wikipedia";
  const day = dayLabel(g.at);
  if (!day) return `#${g.specimenId}`;
  return `#${g.specimenId} · ${g.at!.slice(0, 4) === today.slice(0, 4) ? day.slice(0, day.indexOf(",")) : day}`;
}

/** A plant's date in its In your collection row, to the day: "since May 20, 2025" when it was acquired, else "added Nov 22, 2026". */
export function rowDateLine(t: Pick<Tile, "acquiredOn" | "createdAt">): string {
  const since = dayLabel(t.acquiredOn);
  return since ? `since ${since}` : `added ${dayLabel(t.createdAt) ?? "recently"}`;
}

/** "No photos yet", "1 photo", "9 photos". */
export function photoCountLine(n: number): string {
  if (n === 0) return "No photos yet";
  return n === 1 ? "1 photo" : `${n} photos`;
}

/** The row's meta line, in its parts: where the plant is, its date, how many photos it has. The page joins them with " · " and breaks the line only between them. */
export function rowMeta(t: Pick<Tile, "location" | "acquiredOn" | "createdAt">, photos: number): string[] {
  return [t.location ?? "No location yet", rowDateLine(t), photoCountLine(photos)];
}

const STATUS_ORDER: Record<SpecimenStatus, number> = { alive: 0, gifted: 1, died: 2 };

/** In your collection's rows: the living plants, then those gifted away, then those that died; within each, the newest added first. */
export function collectionRows<T extends Pick<Tile, "id" | "status" | "createdAt">>(tiles: T[]): T[] {
  return [...tiles].sort((a, b) => {
    if (a.status !== b.status) return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return b.id - a.id;
  });
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
  places: Array<{ at: string | null; n: number }>; // where the living plants are, with how many in each; null is no location yet
  gone: number; // plants gifted away or died
  latest: string | null; // when the species' newest plant was added, any status; ISO datetime
  addedAt: string; // when the species joined the collection, its name first confirmed (species.created_at); ISO datetime
  hasSummary: boolean; // Fern has stored a Wikipedia summary for it
  thumbUrl: string | null; // an owner photo's thumbnail first, else the reference's, else none
  imageUrl: string | null; // the same photo at its full 1280 px, for a box too big for the thumbnail
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
