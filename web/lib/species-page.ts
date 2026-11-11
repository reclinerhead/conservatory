// The species page and the species list, pure: what a species is called, its
// breadcrumb, the order of its gallery, what the About card says before and
// after Fern has looked it up, and how the list is sorted and searched. The
// server reads the rows (lib/species.ts); the pages render what this decides.

import { dayLabel, displayName, speciesLabel, type Tile } from "./collection";
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
  specimenName: string;
  path: string; // relative to CONSERVATORY_DATA
  takenAt: string | null;
  uploadedAt: string;
  chosen: boolean; // chosen on its plant's page as the photo the plant is known by (#46)
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

/** Newest first by when the photo was taken (its upload when the EXIF had no date), then the newer id. */
const newestFirst = (a: OwnerPhoto, b: OwnerPhoto) => (when(a) !== when(b) ? (when(a) < when(b) ? 1 : -1) : b.photoId - a.photoId);

/**
 * The gallery, in order: each specimen of this species shown by its main
 * photo (#46: the one chosen on its page, else its newest), newest first by
 * that photo's date, then the reference image. The same rule as the plant's
 * page and the species list's thumbnail (photoOrder in lib/specimens.ts), so
 * a plant looks the same everywhere. Owner photos always outrank the
 * reference, so the reference is the hero only when the household has no
 * photo of this species yet.
 */
export function speciesGallery(photos: OwnerPhoto[], ref: Reference | null): GalleryItem[] {
  const main = new Map<number, OwnerPhoto>();
  for (const p of [...photos].sort(newestFirst)) {
    const held = main.get(p.specimenId);
    if (!held || (p.chosen && !held.chosen)) main.set(p.specimenId, p);
  }
  const items: GalleryItem[] = [];
  for (const p of [...main.values()].sort(newestFirst)) {
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

/** A plant the species page's "Add a photo" can put photos on, named for the status line and the chooser. */
export type PhotoTarget = { id: number; label: string };

/**
 * The plants "Add a photo" on a species page can put a photo on (#55): the
 * living ones, else, when every one has died or been given away, the rest;
 * newest first, as In your collection orders them. Every plant of a species
 * shares the species' name, so each goes by its pot tag number and its place:
 * "Plant #142 · Kitchen", or "Plant #142" with no place set.
 */
export function photoTargets(tiles: Pick<Tile, "id" | "location" | "status" | "createdAt">[]): PhotoTarget[] {
  const living = tiles.filter((t) => t.status === "alive");
  return [...(living.length > 0 ? living : tiles)]
    .sort((a, b) => (a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? 1 : -1) : b.id - a.id))
    .map((t) => ({ id: t.id, label: t.location?.trim() ? `Plant #${t.id} · ${t.location.trim()}` : `Plant #${t.id}` }));
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
