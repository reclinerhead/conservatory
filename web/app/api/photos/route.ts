// POST /api/photos: one photo in, one queued job out.
//
// multipart fields: `file` (the image, already shrunk by the browser when it
// could), `organ` (leaf | flower | fruit | bark | auto), `takenAt` (ISO, from
// the original's EXIF, optional). The file is written under CONSERVATORY_DATA
// as photos/yyyy/mm/<uuid>.<ext>, then a jobs row and a photos row are
// inserted in one transaction. Fern picks the job up from there.

import { openReadWrite } from "@/lib/db";
import { isOrgan } from "@/lib/photos";
import { checkUpload, storeUpload, takenAtFrom } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
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

  const rel = await storeUpload(check.file);

  let db;
  try {
    db = openReadWrite();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
  try {
    db.exec("BEGIN IMMEDIATE");
    const job = db.prepare("INSERT INTO jobs DEFAULT VALUES").run();
    const jobId = Number(job.lastInsertRowid);
    const photo = db
      .prepare("INSERT INTO photos (path, taken_at, organ, job_id) VALUES (?, ?, ?, ?)")
      .run(rel, takenAt, organ, jobId);
    db.exec("COMMIT");
    return Response.json({ jobId, photoId: Number(photo.lastInsertRowid), path: rel }, { status: 201 });
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
