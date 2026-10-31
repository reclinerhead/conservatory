// POST /api/photos: one photo in, one queued job out.
//
// multipart fields: `file` (the image, already shrunk by the browser when it
// could), `organ` (leaf | flower | fruit | bark | auto), `takenAt` (ISO, from
// the original's EXIF, optional). The file is written under CONSERVATORY_DATA
// as photos/yyyy/mm/<uuid>.<ext>, then a jobs row and a photos row are
// inserted in one transaction. Fern picks the job up from there.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir, openReadWrite } from "@/lib/db";
import { extForMime, isOrgan, relPathFor } from "@/lib/photos";

export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "expected multipart form data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) return Response.json({ error: "no file" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "file too large" }, { status: 413 });
  if (!file.type.startsWith("image/") && file.type !== "application/octet-stream")
    return Response.json({ error: "not an image" }, { status: 415 });
  const organRaw = form.get("organ") ?? "auto";
  const organ = isOrgan(organRaw) ? organRaw : "auto";
  const takenAtRaw = form.get("takenAt");
  const takenAt = typeof takenAtRaw === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(takenAtRaw) ? takenAtRaw : null;

  const now = new Date();
  const rel = relPathFor(crypto.randomUUID(), extForMime(file.type), now);
  const abs = path.join(dataDir(), rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, new Uint8Array(await file.arrayBuffer()));

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
