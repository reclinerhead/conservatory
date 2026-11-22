// DELETE /api/plants/:id/health/:checkId: take one health check out of a
// plant's results (#91). The row goes for good; nothing else refers to it,
// and its photos stay. A check that is queued or running answers 409, since
// Fern is about to write to it. The daily cap is counted from the rows that
// exist, so deleting one of today's checks gives that check back.
//
// PATCH, same path: mark one finding of a done check not applicable, or put
// it back (#121). The body is { finding, applicable }; applicable true with
// no finding puts every one back. The finding is hidden on the page, never
// removed from the stored answer, so the others keep their places. 404 for
// no such check on the plant or no such finding, 409 for a check that is not
// done and for a finding that is on the to-do list, 503 before v13.

import { openReadWrite } from "@/lib/db";
import { applicableRequest, withApplicable, type HealthRow } from "@/lib/health";
import { hasHealthChecks, hasTodos } from "@/lib/specimens";
import { findingAt } from "@/lib/todos";

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

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; checkId: string }> }) {
  const params = await ctx.params;
  const plantId = parseId(params.id);
  const checkId = parseId(params.checkId);
  if (!plantId || !checkId) return Response.json({ error: "bad id" }, { status: 400 });
  const body = applicableRequest(await req.json().catch(() => null));
  if (!body.ok) return Response.json({ error: body.error }, { status: 400 });
  let db;
  try {
    db = openReadWrite();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
  try {
    // The v13 column stands for the table too.
    const ready = db.prepare("SELECT 1 FROM pragma_table_info('health_checks') WHERE name = 'not_applicable'").get();
    if (!ready) return Response.json({ error: "Fern has not set this up yet; restart Fern." }, { status: 503 });

    // Read and written in one transaction, so two tabs marking different findings both keep theirs.
    db.exec("BEGIN IMMEDIATE");
    const refuse = (status: number, error: string) => {
      db.exec("ROLLBACK");
      return Response.json({ error }, { status });
    };
    const check = db
      .prepare(
        "SELECT id, state, photo_ids, question, status, summary, answer, model, error, created_at, finished_at, not_applicable FROM health_checks WHERE id = ? AND specimen_id = ?",
      )
      .get(checkId, plantId) as HealthRow | undefined;
    if (!check) return refuse(404, "no such health check on this plant");
    if (check.state !== "done") return refuse(409, "this health check has no findings");
    if (body.finding !== null && !findingAt(check, body.finding)) return refuse(404, "no such finding in this health check");
    if (!body.applicable && hasTodos(db) && db.prepare("SELECT 1 FROM todos WHERE health_check_id = ? AND finding_index = ?").get(checkId, body.finding)) {
      return refuse(409, "This one is on your to-do list. Remove it from the list first.");
    }
    db.prepare("UPDATE health_checks SET not_applicable = ? WHERE id = ?").run(withApplicable(check.not_applicable, body.finding, body.applicable), checkId);
    db.exec("COMMIT");
    return Response.json({ ok: true });
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
