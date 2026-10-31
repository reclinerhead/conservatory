// GET /api/jobs/:id: the job's state and, once Fern has answered, its candidates.
// The add page polls this for the on-the-spot flow; the confirm screen (#7)
// reads the same shape.

import { openReadOnly } from "@/lib/db";
import { thumbPathFor } from "@/lib/photos";

export const dynamic = "force-dynamic";

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
};

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId <= 0) return Response.json({ error: "bad id" }, { status: 400 });
  const db = openReadOnly();
  if (!db) return Response.json({ error: "no database yet" }, { status: 503 });
  try {
    const job = db.prepare("SELECT id, status, error, quota_remaining FROM jobs WHERE id = ?").get(jobId) as
      | { id: number; status: JobView["status"]; error: string | null; quota_remaining: number | null }
      | undefined;
    if (!job) return Response.json({ error: "no such job" }, { status: 404 });
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
    const view: JobView = {
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
    };
    return Response.json(view, { headers: { "cache-control": "no-store" } });
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
