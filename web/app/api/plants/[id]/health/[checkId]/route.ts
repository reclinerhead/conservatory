// DELETE /api/plants/:id/health/:checkId: take one health check out of a
// plant's results (#91). The row goes for good; nothing else refers to it,
// and its photos stay. A check that is queued or running answers 409, since
// Fern is about to write to it. The daily cap is counted from the rows that
// exist, so deleting one of today's checks gives that check back.

import { openReadWrite } from "@/lib/db";
import { hasHealthChecks } from "@/lib/specimens";

export const dynamic = "force-dynamic";

function parseId(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; checkId: string }> }) {
  const params = await ctx.params;
  const plantId = parseId(params.id);
  const checkId = parseId(params.checkId);
  if (!plantId || !checkId) return Response.json({ error: "bad id" }, { status: 400 });
  let db;
  try {
    db = openReadWrite();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
  try {
    if (!hasHealthChecks(db)) return Response.json({ error: "Fern has not set up health checks yet; restart Fern." }, { status: 503 });
    // One statement decides and deletes, so a check Fern claims in between is never taken from under it.
    const r = db.prepare("DELETE FROM health_checks WHERE id = ? AND specimen_id = ? AND state IN ('done', 'failed')").run(checkId, plantId);
    if (r.changes > 0) return Response.json({ ok: true });
    const left = db.prepare("SELECT 1 FROM health_checks WHERE id = ? AND specimen_id = ?").get(checkId, plantId);
    return left
      ? Response.json({ error: "Fern is still looking at this one; it can be deleted once it has finished." }, { status: 409 })
      : Response.json({ error: "no such health check on this plant" }, { status: 404 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    db.close();
  }
}
