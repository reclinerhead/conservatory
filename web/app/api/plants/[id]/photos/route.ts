// POST /api/plants/:id/photos: a photo added straight to a plant from its own
// page (#26). Multipart `file` and optional `takenAt`, with the limits of
// POST /api/photos. Stores the file and inserts one photos row with the
// specimen set and no job: nothing is queued, Pl@ntNet is never asked, and
// nothing appears in the waiting strip. Fern writes the thumbnail on its next
// idle tick (the photos.thumb_at sweep, schema v4).

import { openReadWrite } from "@/lib/db";
import { checkUpload, removeStored, storeUpload, takenAtFrom } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const plantId = Number(id);
  if (!Number.isInteger(plantId) || plantId <= 0) return Response.json({ error: "bad id" }, { status: 400 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "expected multipart form data" }, { status: 400 });
  }
  const check = checkUpload(form);
  if (!check.ok) return Response.json({ error: check.error }, { status: check.status });
  const takenAt = takenAtFrom(form);

  let db;
  try {
    db = openReadWrite();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
  let rel: string | null = null;
  try {
    const plant = db.prepare("SELECT id FROM specimens WHERE id = ?").get(plantId);
    if (!plant) return Response.json({ error: "no such plant" }, { status: 404 });

    rel = await storeUpload(check.file);
    const photo = db
      .prepare("INSERT INTO photos (path, taken_at, organ, specimen_id) VALUES (?, ?, 'auto', ?)")
      .run(rel, takenAt, plantId);
    return Response.json({ photoId: Number(photo.lastInsertRowid), path: rel }, { status: 201 });
  } catch (err) {
    if (rel) await removeStored(rel); // the plant went between the check and the insert, say
    return Response.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    db.close();
  }
}
