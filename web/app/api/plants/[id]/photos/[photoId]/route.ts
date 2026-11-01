// DELETE /api/plants/:id/photos/:photoId: take one photo off a plant (#34).
// A plant keeps at least one photo, so its last one answers 409; the count is
// read inside the write transaction, so two open tabs cannot take the last two
// between them. The row goes, then the original and its thumbnail. A photo
// that came through a job leaves the job, its candidates and its confirmation
// in place: they are how the plant was named. DELETE /api/plants/[id] and
// Change know a job can be left with no photos.

import { openReadWrite } from "@/lib/db";
import { removeStored } from "@/lib/storage";

export const dynamic = "force-dynamic";

function parseId(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; photoId: string }> }) {
  const params = await ctx.params;
  const plantId = parseId(params.id);
  const photoId = parseId(params.photoId);
  if (!plantId || !photoId) return Response.json({ error: "bad id" }, { status: 400 });
  let db;
  try {
    db = openReadWrite();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
  try {
    const photo = db.prepare("SELECT path FROM photos WHERE id = ? AND specimen_id = ?").get(photoId, plantId) as { path: string } | undefined;
    if (!photo) return Response.json({ error: "no such photo on this plant" }, { status: 404 });

    db.exec("BEGIN IMMEDIATE");
    const count = (db.prepare("SELECT COUNT(*) AS n FROM photos WHERE specimen_id = ?").get(plantId) as { n: number }).n;
    if (count <= 1) {
      db.exec("ROLLBACK");
      return Response.json({ error: "a plant keeps at least one photo" }, { status: 409 });
    }
    const r = db.prepare("DELETE FROM photos WHERE id = ? AND specimen_id = ?").run(photoId, plantId);
    db.exec("COMMIT");
    if (r.changes === 0) return Response.json({ error: "no such photo on this plant" }, { status: 404 }); // another tab took it first

    await removeStored(photo.path);
    return Response.json({ ok: true, photosLeft: count - 1 });
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
