// GET /api/jobs/:id: the job's state and, once Fern has answered, its candidates.
// The add page and the confirm screen poll this for the on-the-spot flow.

import { readJob, withReadDb } from "@/lib/jobs";

export type { JobCandidate, JobView } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId <= 0) return Response.json({ error: "bad id" }, { status: 400 });
  const view = withReadDb((db) => readJob(db, jobId), undefined);
  if (view === undefined) return Response.json({ error: "no database yet" }, { status: 503 });
  if (view === null) return Response.json({ error: "no such job" }, { status: 404 });
  return Response.json(view, { headers: { "cache-control": "no-store" } });
}
