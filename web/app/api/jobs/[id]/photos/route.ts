// POST /api/jobs/:id/photos: another photo of the same plant (the on-the-spot
// flow's "add another photo"). Stores the file, adds a photos row to the job,
// and sends the job back to the queue so Fern asks again with every photo.
// Refused once the job has been confirmed.

import { openReadWrite } from "@/lib/db";
import { isOrgan } from "@/lib/photos";
import { checkUpload, storeUpload, takenAtFrom } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId <= 0) return Response.json({ error: "bad id" }, { status: 400 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "expected multipart form data" }, { status: 400 });
  }
  const check = checkUpload(form);
  if (!check.ok) return Response.json({ error: check.error }, { status: check.status });
  const organRaw = form.get("organ") ?? "auto";
  const organ = isOrgan(organRaw) ? organRaw : "auto";
  const takenAt = takenAtFrom(form);

  let db;
  try {
    db = openReadWrite();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
  try {
    const job = db.prepare("SELECT id FROM jobs WHERE id = ?").get(jobId);
    if (!job) return Response.json({ error: "no such job" }, { status: 404 });
    const confirmed = db.prepare("SELECT 1 FROM confirmations WHERE job_id = ?").get(jobId);
    if (confirmed) return Response.json({ error: "already named" }, { status: 409 });
    const count = (db.prepare("SELECT COUNT(*) AS n FROM photos WHERE job_id = ?").get(jobId) as { n: number }).n;
    if (count >= 5) return Response.json({ error: "five photos is the most Fern can send" }, { status: 409 });

    const rel = await storeUpload(check.file);
    db.exec("BEGIN IMMEDIATE");
    const photo = db
      .prepare("INSERT INTO photos (path, taken_at, organ, job_id) VALUES (?, ?, ?, ?)")
      .run(rel, takenAt, organ, jobId);
    db.prepare("UPDATE jobs SET status = 'queued', finished_at = NULL, error = NULL, next_attempt_at = NULL WHERE id = ?").run(jobId);
    db.exec("COMMIT");
    return Response.json({ photoId: Number(photo.lastInsertRowid), path: rel }, { status: 201 });
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* nothing to roll back */
    }
    return Response.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    db.close();
  }
}
