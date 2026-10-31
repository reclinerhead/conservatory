// Reading species for the species page and the species list. Server only.
// Everything here is what Fern wrote (the confirm route's row, then the
// enrichment pass's columns, schema v2); the web app never calls GBIF or
// Wikipedia. The shaping is pure, in lib/species-page.ts.

import type { DatabaseSync } from "node:sqlite";
import { tileName, type Tile } from "./collection";
import { referenceUrls, thumbPathFor } from "./photos";
import { compareSpecies, type Naming, type OwnerPhoto, type SpeciesListRow } from "./species-page";
import { collectionTiles } from "./specimens";

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
};

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
  const names = new Map(tiles.map((t) => [t.id, tileName(t)]));
  const photos = (
    db
      .prepare(
        `SELECT p.id, p.path, p.taken_at, p.uploaded_at, p.specimen_id
           FROM photos p JOIN specimens sp ON sp.id = p.specimen_id
          WHERE sp.species_id = ?`,
      )
      .all(id) as Array<{ id: number; path: string; taken_at: string | null; uploaded_at: string; specimen_id: number }>
  ).map((p) => ({
    photoId: p.id,
    specimenId: p.specimen_id,
    specimenName: names.get(p.specimen_id) ?? r.scientific_name,
    path: p.path,
    takenAt: p.taken_at,
    uploadedAt: p.uploaded_at,
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
  };
}

/** Every species, most owned first, for /species. The thumbnail is an owner photo's when there is one: owner photos outrank the reference everywhere. */
export function speciesList(db: DatabaseSync): SpeciesListRow[] {
  const rows = db
    .prepare(
      `SELECT s.id, s.scientific_name, s.cultivar, s.common_name, s.canonical_name, s.family, s.genus, s.image_path, s.enriched_at,
              (SELECT COUNT(*) FROM specimens sp WHERE sp.species_id = s.id AND sp.status = 'alive') AS n,
              (SELECT p.path FROM photos p JOIN specimens sp ON sp.id = p.specimen_id
                WHERE sp.species_id = s.id
                ORDER BY COALESCE(p.taken_at, p.uploaded_at) DESC, p.id DESC LIMIT 1) AS hero
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
      thumbUrl: r.hero ? `/media/${thumbPathFor(r.hero)}` : (referenceUrls(r.image_path, r.enriched_at)?.thumbUrl ?? null),
    }))
    .sort(compareSpecies);
}
