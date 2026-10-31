// Reading jobs for the confirm screen and the jobs API. Server only.

import type { DatabaseSync } from "node:sqlite";
import { openReadOnly } from "./db";
import { thumbPathFor } from "./photos";

export type JobCandidate = {
  kind: "species" | "genus" | "family";
  rank: number;
  scientificName: string;
  genus: string | null;
  family: string | null;
  score: number;
  gbifId: string | null;
  commonNames: string[];
};

export type JobView = {
  id: number;
  status: "queued" | "identifying" | "identified" | "rejected" | "failed";
  error: string | null;
  quotaRemaining: number | null;
  photos: Array<{ id: number; url: string; thumbUrl: string; organ: string; takenAt: string | null }>;
  candidates: JobCandidate[];
  confirmation: { specimenId: number; name: string; chosenRank: number | null; typedName: string | null } | null;
};

/** How a specimen is named in prose: its nickname, else "Ficus elastica 'Ruby'". Needs `sp` (specimens) and `s` (species) in scope. */
const SPECIMEN_NAME = `COALESCE(sp.nickname, s.scientific_name || CASE WHEN s.cultivar IS NOT NULL THEN ' ''' || s.cultivar || '''' ELSE '' END)`;

export function readJob(db: DatabaseSync, jobId: number): JobView | null {
  const job = db.prepare("SELECT id, status, error, quota_remaining FROM jobs WHERE id = ?").get(jobId) as
    | { id: number; status: JobView["status"]; error: string | null; quota_remaining: number | null }
    | undefined;
  if (!job) return null;
  const photos = db
    .prepare("SELECT id, path, organ, taken_at FROM photos WHERE job_id = ? ORDER BY id")
    .all(jobId) as Array<{ id: number; path: string; organ: string; taken_at: string | null }>;
  const candidates = db
    .prepare(
      `SELECT kind, rank, scientific_name, genus, family, score, gbif_id, common_names
         FROM candidates WHERE job_id = ?
        ORDER BY CASE kind WHEN 'species' THEN 0 WHEN 'genus' THEN 1 ELSE 2 END, rank`,
    )
    .all(jobId) as Array<{
    kind: JobCandidate["kind"];
    rank: number;
    scientific_name: string;
    genus: string | null;
    family: string | null;
    score: number;
    gbif_id: string | null;
    common_names: string;
  }>;
  const conf = db
    .prepare(
      `SELECT c.specimen_id, c.chosen_rank, c.typed_name, ${SPECIMEN_NAME} AS name
         FROM confirmations c
         JOIN specimens sp ON sp.id = c.specimen_id
         JOIN species s ON s.id = sp.species_id
        WHERE c.job_id = ?`,
    )
    .get(jobId) as { specimen_id: number; chosen_rank: number | null; typed_name: string | null; name: string } | undefined;
  return {
    id: job.id,
    status: job.status,
    error: job.error,
    quotaRemaining: job.quota_remaining,
    photos: photos.map((p) => ({
      id: p.id,
      url: `/media/${p.path}`,
      thumbUrl: `/media/${thumbPathFor(p.path)}`,
      organ: p.organ,
      takenAt: p.taken_at,
    })),
    candidates: candidates.map((c) => ({
      kind: c.kind,
      rank: c.rank,
      scientificName: c.scientific_name,
      genus: c.genus,
      family: c.family,
      score: c.score,
      gbifId: c.gbif_id,
      commonNames: safeNames(c.common_names),
    })),
    confirmation: conf
      ? { specimenId: conf.specimen_id, name: conf.name, chosenRank: conf.chosen_rank, typedName: conf.typed_name }
      : null,
  };
}

/** Ids of jobs waiting for a name, oldest first. A job the person has not yet confirmed, identified or rejected. */
export function waitingJobIds(db: DatabaseSync): number[] {
  const rows = db
    .prepare(
      `SELECT j.id FROM jobs j
        WHERE j.status IN ('identified', 'rejected')
          AND NOT EXISTS (SELECT 1 FROM confirmations c WHERE c.job_id = j.id)
        ORDER BY j.created_at, j.id`,
    )
    .all() as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

/** The next waiting job after `current`, wrapping to the first; null when nothing else waits. */
export function nextWaitingJob(ids: number[], current: number): number | null {
  const others = ids.filter((id) => id !== current);
  if (others.length === 0) return null;
  const later = others.find((id) => id > current);
  return later ?? others[0];
}

/** The specimen the person confirmed most recently, for "same plant as the last one". */
export function lastConfirmedSpecimen(db: DatabaseSync): { id: number; name: string } | null {
  const row = db
    .prepare(
      `SELECT sp.id, ${SPECIMEN_NAME} AS name
         FROM confirmations c
         JOIN specimens sp ON sp.id = c.specimen_id
         JOIN species s ON s.id = sp.species_id
        ORDER BY c.confirmed_at DESC LIMIT 1`,
    )
    .get() as { id: number; name: string } | undefined;
  return row ? { id: row.id, name: row.name } : null;
}

export function withReadDb<T>(fn: (db: DatabaseSync) => T, fallback: T): T {
  const db = openReadOnly();
  if (!db) return fallback;
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function safeNames(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
