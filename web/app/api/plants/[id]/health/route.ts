// POST /api/plants/:id/health: "Check health" on a plant's page (#87). Queues
// one health check: a `health_checks` row in state `queued` with the chosen
// photos and the owner's question. Fern takes it on its next idle tick, asks
// the vision model once and writes the answer on the row (fern/health.py);
// the web app never calls the model and this request never waits on one.
//
// Refused without inserting: 400 for a bad body or a photo not on this plant,
// 404 for no such plant, 409 for a plant no longer here, for one with a check
// already queued or running, and for the same photos and question as its last
// finished check (the result is on the page), 429 once the household has
// started CONSERVATORY_HEALTH_DAILY_MAX checks today by the station's
// calendar, and 503 with no AI_GATEWAY_API_KEY or before Fern has made the
// table. The checks are read inside the write transaction, so two presses
// cannot both get through.

import { openReadWrite } from "@/lib/db";
import { capReached, checkRequest, dailyMax, healthView, sameAsLast, type HealthRow } from "@/lib/health";
import { careModelConfigured } from "@/lib/species";
import { hasHealthChecks } from "@/lib/specimens";

export const dynamic = "force-dynamic";

const COLUMNS = "id, state, photo_ids, question, status, summary, answer, model, error, created_at, finished_at";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "bad id" }, { status: 400 });
  const body = checkRequest(await req.json().catch(() => null));
  if (!body.ok) return Response.json({ error: body.error }, { status: 400 });
  // Both units read the same environment file, so the key's presence here says Fern has a model.
  if (!careModelConfigured()) return Response.json({ error: "Health checks are off: this box has no AI_GATEWAY_API_KEY." }, { status: 503 });
  let db;
  try {
    db = openReadWrite();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
  try {
    if (!hasHealthChecks(db)) return Response.json({ error: "Fern has not set up health checks yet; restart Fern." }, { status: 503 });
    const plant = db.prepare("SELECT status FROM specimens WHERE id = ?").get(id) as { status: string } | undefined;
    if (!plant) return Response.json({ error: "no such plant" }, { status: 404 });
    if (plant.status !== "alive") return Response.json({ error: "This plant is no longer here." }, { status: 409 });

    db.exec("BEGIN IMMEDIATE");
    const refuse = (status: number, error: string) => {
      db.exec("ROLLBACK");
      return Response.json({ error }, { status });
    };

    const own = new Set((db.prepare("SELECT id FROM photos WHERE specimen_id = ?").all(id) as Array<{ id: number }>).map((p) => p.id));
    if (!body.photoIds.every((p) => own.has(p))) return refuse(400, "One of those photos is not on this plant.");

    const inFlight = db.prepare("SELECT 1 FROM health_checks WHERE specimen_id = ? AND state IN ('queued', 'running')").get(id);
    if (inFlight) return refuse(409, "Fern is already looking at this plant. Its answer will show in the Health card.");

    // The plant's last finished check, done or failed. A failed one never
    // stops a new one; a done one with the same photos and question does.
    const last = db
      .prepare("SELECT state, photo_ids, question FROM health_checks WHERE specimen_id = ? AND state IN ('done', 'failed') ORDER BY id DESC LIMIT 1")
      .get(id) as Pick<HealthRow, "state" | "photo_ids" | "question"> | undefined;
    if (last?.state === "done") {
      let lastIds: number[] = [];
      try {
        lastIds = JSON.parse(last.photo_ids) as number[];
      } catch {
        /* unreadable: not the same */
      }
      if (Array.isArray(lastIds) && sameAsLast({ photoIds: lastIds, question: last.question }, body.photoIds, body.question)) {
        return refuse(409, "That is the same photos and question as the last check. Its result is in the Health card.");
      }
    }

    // The household's cap, counted by the station's own day. Two days back
    // covers every timezone's "today"; the count itself is done in local time.
    const max = dailyMax(process.env["CONSERVATORY_HEALTH_DAILY_MAX"]);
    const recent = (
      db.prepare("SELECT created_at FROM health_checks WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days')").all() as Array<{ created_at: string }>
    ).map((r) => r.created_at);
    if (capReached(recent, new Date(), max)) {
      return refuse(429, `The household has used today's ${max} health check${max === 1 ? "" : "s"}. They come back at midnight.`);
    }

    const r = db.prepare("INSERT INTO health_checks (specimen_id, photo_ids, question) VALUES (?, ?, ?)").run(id, JSON.stringify(body.photoIds), body.question);
    const row = db.prepare(`SELECT ${COLUMNS} FROM health_checks WHERE id = ?`).get(Number(r.lastInsertRowid)) as HealthRow;
    db.exec("COMMIT");
    return Response.json({ check: healthView(row) }, { status: 201 });
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
