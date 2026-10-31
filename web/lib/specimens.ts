// Reading specimens for the collection grid and the specimen page. Server only.

import type { DatabaseSync } from "node:sqlite";
import type { SpecimenStatus, Tile } from "./collection";
import { thumbPathFor } from "./photos";

type TileRow = {
  id: number;
  nickname: string | null;
  scientific_name: string;
  cultivar: string | null;
  location: string | null;
  acquired_on: string | null;
  status: SpecimenStatus;
  created_at: string;
  hero: string | null;
};

/** The newest photo of a specimen, by when it was taken (upload time when the EXIF had no date). */
const HERO = `(SELECT p.path FROM photos p WHERE p.specimen_id = sp.id
                 ORDER BY COALESCE(p.taken_at, p.uploaded_at) DESC, p.id DESC LIMIT 1)`;

/** Every specimen as a grid tile (or every specimen of one species), in no particular order: the caller groups and sorts. */
export function collectionTiles(db: DatabaseSync, speciesId?: number): Tile[] {
  const sql = `SELECT sp.id, sp.nickname, sp.location, sp.acquired_on, sp.status, sp.created_at,
                      s.scientific_name, s.cultivar, ${HERO} AS hero
                 FROM specimens sp JOIN species s ON s.id = sp.species_id`;
  const rows = (
    speciesId === undefined ? db.prepare(sql).all() : db.prepare(`${sql} WHERE sp.species_id = ?`).all(speciesId)
  ) as TileRow[];
  return rows.map((r) => ({
    id: r.id,
    nickname: r.nickname,
    scientificName: r.scientific_name,
    cultivar: r.cultivar,
    location: r.location,
    acquiredOn: r.acquired_on,
    status: r.status,
    createdAt: r.created_at,
    thumbUrl: r.hero ? `/media/${thumbPathFor(r.hero)}` : null,
  }));
}

export type SpecimenView = {
  id: number;
  nickname: string | null;
  location: string | null;
  acquiredOn: string | null;
  status: SpecimenStatus;
  createdAt: string;
  species: { id: number; scientificName: string; genus: string | null; family: string | null; cultivar: string | null; commonName: string | null };
  photos: Array<{ id: number; url: string; thumbUrl: string; takenAt: string | null; uploadedAt: string }>;
  named: { how: "pill" | "typed" | "same"; at: string } | null;
};

export function readSpecimen(db: DatabaseSync, id: number): SpecimenView | null {
  const row = db
    .prepare(
      `SELECT sp.id, sp.nickname, sp.location, sp.acquired_on, sp.status, sp.created_at,
              s.id AS species_id, s.scientific_name, s.genus, s.family, s.cultivar, s.common_name
         FROM specimens sp JOIN species s ON s.id = sp.species_id
        WHERE sp.id = ?`,
    )
    .get(id) as
    | {
        id: number;
        nickname: string | null;
        location: string | null;
        acquired_on: string | null;
        status: SpecimenStatus;
        created_at: string;
        species_id: number;
        scientific_name: string;
        genus: string | null;
        family: string | null;
        cultivar: string | null;
        common_name: string | null;
      }
    | undefined;
  if (!row) return null;
  // Newest first by when the photo was taken; a photo without a date sorts by its upload.
  const photos = db
    .prepare(
      `SELECT id, path, taken_at, uploaded_at FROM photos WHERE specimen_id = ?
        ORDER BY COALESCE(taken_at, uploaded_at) DESC, id DESC`,
    )
    .all(id) as Array<{ id: number; path: string; taken_at: string | null; uploaded_at: string }>;
  const conf = db
    .prepare("SELECT chosen_rank, typed_name, confirmed_at FROM confirmations WHERE specimen_id = ? ORDER BY confirmed_at LIMIT 1")
    .get(id) as { chosen_rank: number | null; typed_name: string | null; confirmed_at: string } | undefined;
  return {
    id: row.id,
    nickname: row.nickname,
    location: row.location,
    acquiredOn: row.acquired_on,
    status: row.status,
    createdAt: row.created_at,
    species: {
      id: row.species_id,
      scientificName: row.scientific_name,
      genus: row.genus,
      family: row.family,
      cultivar: row.cultivar,
      commonName: row.common_name,
    },
    photos: photos.map((p) => ({
      id: p.id,
      url: `/media/${p.path}`,
      thumbUrl: `/media/${thumbPathFor(p.path)}`,
      takenAt: p.taken_at,
      uploadedAt: p.uploaded_at,
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
