// Reading specimens for the collection grid and the specimen page. Server only.

import type { DatabaseSync } from "node:sqlite";
import type { SpecimenStatus, Tile } from "./collection";
import { thumbPathFor } from "./photos";

type TileRow = {
  id: number;
  scientific_name: string;
  cultivar: string | null;
  common_name: string | null;
  location: string | null;
  acquired_on: string | null;
  status: SpecimenStatus;
  created_at: string;
  hero: string | null;
};

/**
 * Whether the specimens table has `hero_photo_id` (schema v6, #46). A database
 * Fern has not migrated yet has none, which reads as no main photo chosen.
 */
export function hasHeroPhoto(db: DatabaseSync): boolean {
  return db.prepare("SELECT 1 FROM pragma_table_info('specimens') WHERE name = 'hero_photo_id'").get() !== undefined;
}

/**
 * A plant's photos in the order every screen shows them, as an ORDER BY over
 * the photos alias `p`: the main photo first (#46, chosen on the plant's
 * page), then newest first by when it was taken (upload time when the EXIF
 * had no date), then id. With nothing chosen, or before v6, it is newest
 * first. The card, the plant's page, the species gallery and the species
 * list's thumbnail all read this, so they agree by construction.
 */
export function photoOrder(db: DatabaseSync, p = "p"): string {
  const newest = `COALESCE(${p}.taken_at, ${p}.uploaded_at) DESC, ${p}.id DESC`;
  return hasHeroPhoto(db) ? `(${p}.id = (SELECT h.hero_photo_id FROM specimens h WHERE h.id = ${p}.specimen_id)) DESC, ${newest}` : newest;
}

/** Every specimen as a grid tile (or every specimen of one species), in no particular order: the caller groups and sorts. */
export function collectionTiles(db: DatabaseSync, speciesId?: number): Tile[] {
  const hero = `(SELECT p.path FROM photos p WHERE p.specimen_id = sp.id ORDER BY ${photoOrder(db)} LIMIT 1)`;
  const sql = `SELECT sp.id, sp.location, sp.acquired_on, sp.status, sp.created_at,
                      s.scientific_name, s.cultivar, s.common_name, ${hero} AS hero
                 FROM specimens sp JOIN species s ON s.id = sp.species_id`;
  const rows = (
    speciesId === undefined ? db.prepare(sql).all() : db.prepare(`${sql} WHERE sp.species_id = ?`).all(speciesId)
  ) as TileRow[];
  return rows.map((r) => ({
    id: r.id,
    scientificName: r.scientific_name,
    cultivar: r.cultivar,
    commonName: r.common_name,
    location: r.location,
    acquiredOn: r.acquired_on,
    status: r.status,
    createdAt: r.created_at,
    thumbUrl: r.hero ? `/media/${thumbPathFor(r.hero)}` : null,
  }));
}

/**
 * Whether the specimens table has `tagged_at` (schema v5, #36). A database
 * Fern has not migrated yet has none, which reads as no plant tagged.
 */
export function hasTaggedAt(db: DatabaseSync): boolean {
  return db.prepare("SELECT 1 FROM pragma_table_info('specimens') WHERE name = 'tagged_at'").get() !== undefined;
}

export type TagRow = Tile & { speciesId: number; taggedAt: string | null };

/** Every living specimen as a tile with its species and when its pot tag was last marked, for /tags. Unordered: the caller groups. */
export function tagRows(db: DatabaseSync): TagRow[] {
  const tagged = hasTaggedAt(db) ? "tagged_at" : "NULL";
  const extra = new Map(
    (db.prepare(`SELECT id, species_id, ${tagged} AS tagged_at FROM specimens WHERE status = 'alive'`).all() as Array<{
      id: number;
      species_id: number;
      tagged_at: string | null;
    }>).map((r) => [r.id, r]),
  );
  return collectionTiles(db).flatMap((t) => {
    const e = extra.get(t.id);
    return e ? [{ ...t, speciesId: e.species_id, taggedAt: e.tagged_at }] : [];
  });
}

export type SpecimenView = {
  id: number;
  location: string | null;
  acquiredOn: string | null;
  status: SpecimenStatus;
  createdAt: string;
  taggedAt: string | null;
  species: { id: number; scientificName: string; genus: string | null; family: string | null; cultivar: string | null; commonName: string | null };
  photos: Array<{ id: number; url: string; thumbUrl: string; takenAt: string | null; uploadedAt: string; main: boolean }>; // the main photo first (#46)
  named: { how: "pill" | "typed" | "same"; at: string } | null;
};

export function readSpecimen(db: DatabaseSync, id: number): SpecimenView | null {
  const row = db
    .prepare(
      `SELECT sp.id, sp.location, sp.acquired_on, sp.status, sp.created_at,
              ${hasTaggedAt(db) ? "sp.tagged_at" : "NULL"} AS tagged_at,
              s.id AS species_id, s.scientific_name, s.genus, s.family, s.cultivar, s.common_name
         FROM specimens sp JOIN species s ON s.id = sp.species_id
        WHERE sp.id = ?`,
    )
    .get(id) as
    | {
        id: number;
        location: string | null;
        acquired_on: string | null;
        status: SpecimenStatus;
        created_at: string;
        tagged_at: string | null;
        species_id: number;
        scientific_name: string;
        genus: string | null;
        family: string | null;
        cultivar: string | null;
        common_name: string | null;
      }
    | undefined;
  if (!row) return null;
  // The main photo first, then newest first by when it was taken. The first is
  // the hero, so it is the main photo whether chosen or simply the newest.
  const photos = db
    .prepare(`SELECT p.id, p.path, p.taken_at, p.uploaded_at FROM photos p WHERE p.specimen_id = ? ORDER BY ${photoOrder(db)}`)
    .all(id) as Array<{ id: number; path: string; taken_at: string | null; uploaded_at: string }>;
  const conf = db
    .prepare("SELECT chosen_rank, typed_name, confirmed_at FROM confirmations WHERE specimen_id = ? ORDER BY confirmed_at LIMIT 1")
    .get(id) as { chosen_rank: number | null; typed_name: string | null; confirmed_at: string } | undefined;
  return {
    id: row.id,
    location: row.location,
    acquiredOn: row.acquired_on,
    status: row.status,
    createdAt: row.created_at,
    taggedAt: row.tagged_at,
    species: {
      id: row.species_id,
      scientificName: row.scientific_name,
      genus: row.genus,
      family: row.family,
      cultivar: row.cultivar,
      commonName: row.common_name,
    },
    photos: photos.map((p, i) => ({
      id: p.id,
      url: `/media/${p.path}`,
      thumbUrl: `/media/${thumbPathFor(p.path)}`,
      takenAt: p.taken_at,
      uploadedAt: p.uploaded_at,
      main: i === 0,
    })),
    named: conf ? { how: conf.chosen_rank !== null ? "pill" : conf.typed_name ? "typed" : "same", at: conf.confirmed_at } : null,
  };
}

/** Every location in use, for the location field's suggestions. Most plants first. */
export function knownLocations(db: DatabaseSync): string[] {
  const rows = db
    .prepare("SELECT location FROM specimens WHERE location IS NOT NULL GROUP BY location ORDER BY COUNT(*) DESC, location")
    .all() as Array<{ location: string }>;
  return rows.map((r) => r.location);
}
