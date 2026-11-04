// POST /api/jobs { photoIds }: one plant in, one queued job out.
//
// The add page sends a plant's photos first (POST /api/photos, each without a
// job), then this: the job, and every photo linked to it, in one transaction,
// so Fern only ever sees the whole plant. At most five photos, Fern's
// MAX_IMAGES. What to do is `planJob` (lib/jobs.ts, pure): a photo that is
// gone is 404, one already on a plant or photos split across jobs 409, and
// when every photo is already on one job that job is the answer, so a retry
// whose first response was lost gets the same job rather than a second one.

import type { DatabaseSync } from "node:sqlite";
import { openReadWrite } from "@/lib/db";
import { photoIdsFrom, planJob, type PhotoLink } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected JSON" }, { status: 400 });
  }
  const ids = photoIdsFrom(body);
  if (!ids) return Response.json({ error: "photoIds must be one to five distinct photo ids" }, { status: 400 });

  let db: DatabaseSync;
  try {
    db = openReadWrite();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
  try {
    const marks = ids.map(() => "?").join(", ");
    db.exec("BEGIN IMMEDIATE");
    const rows = (
      db.prepare(`SELECT id, job_id, specimen_id FROM photos WHERE id IN (${marks})`).all(...ids) as Array<{
        id: number;
        job_id: number | null;
        specimen_id: number | null;
      }>
    ).map<PhotoLink>((r) => ({ id: r.id, jobId: r.job_id, specimenId: r.specimen_id }));
    const plan = planJob(ids, rows);
    if (plan.kind !== "make") {
      db.exec("ROLLBACK");
      if (plan.kind === "same") return Response.json({ jobId: plan.jobId });
      return Response.json({ error: plan.error }, { status: plan.status });
    }
    const jobId = Number(db.prepare("INSERT INTO jobs DEFAULT VALUES").run().lastInsertRowid);
    db.prepare(`UPDATE photos SET job_id = ? WHERE id IN (${marks})`).run(jobId, ...ids);
    db.exec("COMMIT");
    return Response.json({ jobId }, { status: 201 });
  } catch (err) {
    if (db.isTransaction) db.exec("ROLLBACK");
    return Response.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    db.close();
  }
}
