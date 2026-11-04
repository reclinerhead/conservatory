// Reading species for the species page and the species list. Server only.
// Everything here is what Fern wrote (the confirm route's row, then the
// enrichment pass's columns, schema v2); the web app never calls GBIF or
// Wikipedia. The shaping is pure, in lib/species-page.ts.

import type { DatabaseSync } from "node:sqlite";
import { careState, type CareRow, type CareState } from "./care";
import { speciesLabel, type Tile } from "./collection";
import { referenceUrls, thumbPathFor } from "./photos";
import { relativesOf, type Relatives } from "./relatives";
import { compareSpecies, type Naming, type OwnerPhoto, type SpeciesListRow } from "./species-page";
import { collectionTiles, hasHeroPhoto, hasTaggedAt, photoOrder } from "./specimens";

export type SpeciesView = {
  id: number;
  scientificName: string;
  cultivar: string | null;
  commonName: string | null;
  canonicalName: string | null;
  authorship: string | null;
  rank: string | null;
  kingdom: string | null;
  phylum: string | null;
  class: string | null;
  order: string | null;
  family: string | null;
  genus: string | null;
  gbifKey: number | null;
  summary: string | null;
  summaryUrl: string | null;
  reference: { url: string; thumbUrl: string; credit: string | null; sourceUrl: string | null } | null;
  enrichedAt: string | null;
  tiles: Tile[];
  photos: OwnerPhoto[];
  naming: Naming;
  relatives: Relatives;
  care: CareState;
  careModel: boolean; // whether this box has a care model configured; Rewrite is offered only then
  tags: { ready: number; sampleId: number | null }; // living specimens with no pot tag yet; the newest living one, whose code the card shows
};

/**
 * Whether Fern has a care model on this box. Both units read the same
 * environment file, so the web app can tell from the key's presence; it never
 * uses the key. Bracket access so Next reads it at runtime, not at build.
 */
export function careModelConfigured(): boolean {
  return (process.env["AI_GATEWAY_API_KEY"] ?? "").trim() !== "";
}

/** The species' care sheet row, or null. A database Fern has not migrated to v3 yet has no table, which reads as no sheet. */
function readCareRow(db: DatabaseSync, id: number): CareRow | null {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'care_sheets'").get();
  if (!table) return null;
  const r = db
    .prepare("SELECT zone, model, cells, notes, written_at, tried_at, error FROM care_sheets WHERE species_id = ?")
    .get(id) as
    | { zone: string | null; model: string | null; cells: string | null; notes: string | null; written_at: string | null; tried_at: string; error: string | null }
    | undefined;
  return r ? { zone: r.zone, model: r.model, cells: r.cells, notes: r.notes, writtenAt: r.written_at, triedAt: r.tried_at, error: r.error } : null;
}

type Row = {
  id: number;
  scientific_name: string;
  cultivar: string | null;
  common_name: string | null;
  canonical_name: string | null;
  authorship: string | null;
  rank: string | null;
  kingdom: string | null;
  phylum: string | null;
  class: string | null;
  order_: string | null;
  family: string | null;
  genus: string | null;
  gbif_key: number | null;
  summary: string | null;
  summary_url: string | null;
  image_path: string | null;
  image_credit: string | null;
  image_source_url: string | null;
  enriched_at: string | null;
};

export function readSpecies(db: DatabaseSync, id: number): SpeciesView | null {
  const r = db
    .prepare(
      `SELECT id, scientific_name, cultivar, common_name, canonical_name, authorship, rank, kingdom, phylum, class, order_,
              family, genus, gbif_key, summary, summary_url, image_path, image_credit, image_source_url, enriched_at
         FROM species WHERE id = ?`,
    )
    .get(id) as Row | undefined;
  if (!r) return null;

  const tiles = collectionTiles(db, id);
  // Each with whether it is the photo its plant is known by (#46); the gallery picks one per plant.
  const photos = (
    db
      .prepare(
        `SELECT p.id, p.path, p.taken_at, p.uploaded_at, p.specimen_id,
                ${hasHeroPhoto(db) ? "p.id = sp.hero_photo_id" : "0"} AS chosen
           FROM photos p JOIN specimens sp ON sp.id = p.specimen_id
          WHERE sp.species_id = ?`,
      )
      .all(id) as Array<{ id: number; path: string; taken_at: string | null; uploaded_at: string; specimen_id: number; chosen: number | null }>
  ).map((p) => ({
    photoId: p.id,
    specimenId: p.specimen_id,
    specimenName: speciesLabel(r.scientific_name, r.cultivar), // every plant of a species goes by the species' name
    path: p.path,
    takenAt: p.taken_at,
    uploadedAt: p.uploaded_at,
    chosen: p.chosen === 1,
  }));

  // The confirmation that brought this species in: the earliest one on any of
  // its specimens. Its score is the candidate the person tapped, matched on
  // the name too, because a genus row and a species row can share a rank.
  const conf = db
    .prepare(
      `SELECT cf.chosen_rank, cf.typed_name, cf.confirmed_at,
              (SELECT c.score FROM candidates c
                WHERE c.job_id = cf.job_id AND c.rank = cf.chosen_rank AND lower(c.scientific_name) = lower(?)
                ORDER BY c.kind = 'species' DESC LIMIT 1) AS score
         FROM confirmations cf JOIN specimens sp ON sp.id = cf.specimen_id
        WHERE sp.species_id = ?
        ORDER BY cf.confirmed_at, cf.job_id LIMIT 1`,
    )
    .get(r.scientific_name, id) as { chosen_rank: number | null; typed_name: string | null; confirmed_at: string; score: number | null } | undefined;
  const naming: Naming = conf
    ? { how: conf.chosen_rank !== null ? "pill" : conf.typed_name ? "typed" : "same", score: conf.score, at: conf.confirmed_at }
    : null;

  const tagged = hasTaggedAt(db) ? "tagged_at" : "NULL";
  const tags = db
    .prepare(
      `SELECT COALESCE(SUM(${tagged} IS NULL), 0) AS ready,
              (SELECT id FROM specimens WHERE species_id = ? AND status = 'alive' ORDER BY created_at DESC, id DESC LIMIT 1) AS sample
         FROM specimens WHERE species_id = ? AND status = 'alive'`,
    )
    .get(id, id) as { ready: number; sample: number | null };

  const ref = referenceUrls(r.image_path, r.enriched_at);
  return {
    id: r.id,
    scientificName: r.scientific_name,
    cultivar: r.cultivar,
    commonName: r.common_name,
    canonicalName: r.canonical_name,
    authorship: r.authorship,
    rank: r.rank,
    kingdom: r.kingdom,
    phylum: r.phylum,
    class: r.class,
    order: r.order_,
    family: r.family,
    genus: r.genus,
    gbifKey: r.gbif_key,
    summary: r.summary,
    summaryUrl: r.summary_url,
    reference: ref ? { ...ref, credit: r.image_credit, sourceUrl: r.image_source_url } : null,
    enrichedAt: r.enriched_at,
    tiles,
    photos,
    naming,
    relatives: relativesOf(r, speciesList(db)),
    care: careState({ row: readCareRow(db, id), configured: careModelConfigured(), gbifKey: r.gbif_key, enrichedAt: r.enriched_at }),
    careModel: careModelConfigured(),
    tags: { ready: tags.ready, sampleId: tags.sample },
  };
}

/**
 * Every species, most owned first, for the home page's species grid and the
 * relatives. With each, its living plants counted by place (a JSON array of
 * { at, n }, at null for no location yet) and its plants no longer here, so
 * the grid filters by place on the phone. The thumbnail is an owner
 * photo's when there is one (owner photos outrank the reference everywhere):
 * the photo that leads the species gallery, which is each plant's main photo
 * (#46), the newest of those.
 */
export function speciesList(db: DatabaseSync): SpeciesListRow[] {
  const rows = db
    .prepare(
      `SELECT s.id, s.scientific_name, s.cultivar, s.common_name, s.canonical_name, s.family, s.genus, s.image_path, s.enriched_at,
              (SELECT COUNT(*) FROM specimens sp WHERE sp.species_id = s.id AND sp.status = 'alive') AS n,
              (SELECT COUNT(*) FROM specimens sp WHERE sp.species_id = s.id AND sp.status <> 'alive') AS gone,
              (SELECT MAX(sp.created_at) FROM specimens sp WHERE sp.species_id = s.id) AS latest,
              (SELECT json_group_array(json_object('at', g.location, 'n', g.c))
                 FROM (SELECT sp.location, COUNT(*) AS c FROM specimens sp
                        WHERE sp.species_id = s.id AND sp.status = 'alive' GROUP BY sp.location) g) AS places,
              (SELECT m.path FROM specimens sp
                 JOIN photos m ON m.id = (SELECT p.id FROM photos p WHERE p.specimen_id = sp.id ORDER BY ${photoOrder(db)} LIMIT 1)
                WHERE sp.species_id = s.id
                ORDER BY COALESCE(m.taken_at, m.uploaded_at) DESC, m.id DESC LIMIT 1) AS hero
         FROM species s`,
    )
    .all() as Array<{
    id: number;
    scientific_name: string;
    cultivar: string | null;
    common_name: string | null;
    canonical_name: string | null;
    family: string | null;
    genus: string | null;
    image_path: string | null;
    enriched_at: string | null;
    n: number;
    gone: number;
    latest: string | null;
    places: string; // JSON
    hero: string | null;
  }>;
  return rows
    .map((r) => ({
      id: r.id,
      scientificName: r.scientific_name,
      cultivar: r.cultivar,
      commonName: r.common_name,
      canonicalName: r.canonical_name,
      family: r.family,
      genus: r.genus,
      specimens: r.n,
      places: JSON.parse(r.places) as Array<{ at: string | null; n: number }>,
      gone: r.gone,
      latest: r.latest,
      thumbUrl: r.hero ? `/media/${thumbPathFor(r.hero)}` : (referenceUrls(r.image_path, r.enriched_at)?.thumbUrl ?? null),
    }))
    .sort(compareSpecies);
}
