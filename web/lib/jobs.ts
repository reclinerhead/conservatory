// Reading jobs for the confirm screen and the jobs API. Server only.

import type { DatabaseSync } from "node:sqlite";
import { openReadOnly } from "./db";
import { SETTLED_JOB_SQL } from "./job-state";
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
  nextAttemptAt: string | null; // set while Fern will retry a failed job (#61); see isSettled in lib/job-state.ts
  quotaRemaining: number | null;
  photos: Array<{ id: number; url: string; thumbUrl: string; organ: string; takenAt: string | null }>;
  candidates: JobCandidate[];
  confirmation: { specimenId: number; name: string; chosenRank: number | null; typedName: string | null } | null;
};

/** How a specimen is named in prose on the confirm screen: its species, "Ficus elastica 'Ruby'". Needs `s` (species) in scope. */
const SPECIMEN_NAME = `s.scientific_name || CASE WHEN s.cultivar IS NOT NULL THEN ' ''' || s.cultivar || '''' ELSE '' END`;

export function readJob(db: DatabaseSync, jobId: number): JobView | null {
  const job = db.prepare("SELECT id, status, error, next_attempt_at, quota_remaining FROM jobs WHERE id = ?").get(jobId) as
    | { id: number; status: JobView["status"]; error: string | null; next_attempt_at: string | null; quota_remaining: number | null }
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
    nextAttemptAt: job.next_attempt_at,
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

export const MAX_JOB_PHOTOS = 5; // Fern's MAX_IMAGES: the most Pl@ntNet takes for one plant

/** The `photoIds` of a POST /api/jobs body: one to five distinct positive integers, or null. */
export function photoIdsFrom(body: unknown): number[] | null {
  const ids = typeof body === "object" && body !== null ? (body as { photoIds?: unknown }).photoIds : undefined;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_JOB_PHOTOS) return null;
  if (!ids.every((id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0)) return null;
  return new Set(ids).size === ids.length ? ids : null;
}

export type PhotoLink = { id: number; jobId: number | null; specimenId: number | null };

export type JobPlan = { kind: "make" } | { kind: "same"; jobId: number } | { kind: "refuse"; status: 404 | 409; error: string };

/**
 * What POST /api/jobs should do for these photos, given the rows it found for
 * them. Pure. A photo that is gone is 404; one already on a plant, or photos
 * split across jobs, is 409. When every photo is already on one job that job
 * is the answer, so a retry whose first response was lost gets the job it
 * made rather than a second one.
 */
export function planJob(ids: number[], rows: PhotoLink[]): JobPlan {
  const found = new Set(rows.map((r) => r.id));
  if (ids.some((id) => !found.has(id))) return { kind: "refuse", status: 404, error: "some of these photos are gone" };
  if (rows.some((r) => r.specimenId !== null)) return { kind: "refuse", status: 409, error: "already on a plant" };
  const jobs = new Set(rows.map((r) => r.jobId));
  if (!jobs.has(null)) {
    if (jobs.size === 1) return { kind: "same", jobId: [...jobs][0] as number };
    return { kind: "refuse", status: 409, error: "these photos are on different jobs" };
  }
  if (jobs.size > 1) return { kind: "refuse", status: 409, error: "some of these photos are already on a job" };
  return { kind: "make" };
}

/** Ids of jobs waiting for a name, oldest first: settled (identified, rejected, or failed for good) and not yet confirmed. */
export function waitingJobIds(db: DatabaseSync): number[] {
  const rows = db
    .prepare(
      `SELECT j.id FROM jobs j
        WHERE ${SETTLED_JOB_SQL}
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

/**
 * The first common name in a candidate's `common_names` (a JSON array of
 * strings), trimmed, or null: none, only blanks, or not a JSON array. The
 * confirm route writes it onto the species the pill names (#62).
 */
export function firstCommonName(json: string | null | undefined): string | null {
  if (!json) return null;
  for (const name of safeNames(json)) {
    const t = name.trim();
    if (t) return t;
  }
  return null;
}

function safeNames(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
