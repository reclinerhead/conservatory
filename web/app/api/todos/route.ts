// POST /api/todos: put one finding of a health check on the to-do list
// (#103). The body names the check and the finding's place in it; the text
// is copied from the stored answer here, so the page never supplies it. One
// finding makes one to-do: asking again answers with the one already there.

import { openReadWrite } from "@/lib/db";
import type { HealthRow } from "@/lib/health";
import { hasTodos } from "@/lib/specimens";
import { addRequest, findingAt } from "@/lib/todos";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = addRequest(await req.json().catch(() => null));
  if (!body.ok) return Response.json({ error: body.error }, { status: 400 });
  let db;
  try {
    db = openReadWrite();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
  try {
    if (!hasTodos(db)) return Response.json({ error: "Fern has not set up the to-do list yet; restart Fern." }, { status: 503 });
    const check = db
      .prepare("SELECT id, specimen_id, state, photo_ids, question, status, summary, answer, model, error, created_at, finished_at FROM health_checks WHERE id = ?")
      .get(body.checkId) as (HealthRow & { specimen_id: number }) | undefined;
    if (!check) return Response.json({ error: "no such health check" }, { status: 404 });
    if (check.state !== "done") return Response.json({ error: "this health check has no findings to add" }, { status: 409 });
    const finding = findingAt(check, body.finding);
    if (!finding) return Response.json({ error: "no such finding in this health check" }, { status: 404 });

    const existing = () => db.prepare("SELECT id, completed_at AS completedAt FROM todos WHERE health_check_id = ? AND finding_index = ?").get(body.checkId, body.finding);
    const already = existing();
    if (already) return Response.json(already);
    // OR IGNORE: a second tab adding the same finding in between meets the unique index and is answered with the first one's row.
    const r = db
      .prepare("INSERT OR IGNORE INTO todos (specimen_id, health_check_id, finding_index, seen, remedy, likelihood) VALUES (?, ?, ?, ?, ?, ?)")
      .run(check.specimen_id, body.checkId, body.finding, finding.seen, finding.remedy, finding.likelihood);
    return Response.json(existing(), { status: r.changes > 0 ? 201 : 200 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    db.close();
  }
}
