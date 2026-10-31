// POST /api/species/:id/care: "Rewrite" on the species page. Deletes the
// species' care sheet, which puts it back on Fern's care worklist; Fern
// writes a new one on its next idle tick. The web app never calls the model
// itself and a request never waits on one. Refused when this box has no care
// model, since the sheet would be gone with nothing to replace it.

import { openReadWrite } from "@/lib/db";
import { careModelConfigured } from "@/lib/species";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "bad id" }, { status: 400 });
  if (!careModelConfigured()) return Response.json({ error: "no care model is configured on this box" }, { status: 409 });
  let db;
  try {
    db = openReadWrite();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
  try {
    if (!db.prepare("SELECT 1 FROM species WHERE id = ?").get(id)) return Response.json({ error: "no such species" }, { status: 404 });
    const r = db.prepare("DELETE FROM care_sheets WHERE species_id = ?").run(id);
    return Response.json({ ok: true, cleared: r.changes > 0 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    db.close();
  }
}
