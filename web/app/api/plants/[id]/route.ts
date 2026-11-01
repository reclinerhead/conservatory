// PATCH /api/plants/:id: edit a specimen's own facts: nickname, location,
// the date it was acquired, its status. Any subset; an empty string clears.
//
// DELETE /api/plants/:id: remove the specimen for good. Its photos go from
// the table and from disk, and so do the jobs that brought them (otherwise
// an identified job with no confirmation would reappear in the "waiting for
// a name" strip). The jobs are found through the photos and through the
// plant's confirmations, since a photo removed from the page (#34) leaves its
// job behind with no photo pointing at it. The species row goes too when no
// specimen is left on it, as "Change" does on the confirm screen.

import { openReadWrite } from "@/lib/db";
import { removeStored } from "@/lib/storage";

export const dynamic = "force-dynamic";

const STATUSES = new Set(["alive", "gifted", "died"]);

type Body = { nickname?: unknown; location?: unknown; acquiredOn?: unknown; status?: unknown };

/** A trimmed string of at most `max` characters, or null when blank; undefined when the field was not sent. */
function text(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t.length === 0 ? null : t.slice(0, max);
}

function parseId(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseId((await ctx.params).id);
  if (!id) return Response.json({ error: "bad id" }, { status: 400 });
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "expected json" }, { status: 400 });
  }

  const sets: string[] = [];
  const values: Array<string | null> = [];
  const nickname = text(body.nickname, 80);
  if (nickname !== undefined) {
    sets.push("nickname = ?");
    values.push(nickname);
  }
  const location = text(body.location, 80);
  if (location !== undefined) {
    sets.push("location = ?");
    values.push(location);
  }
  const acquired = text(body.acquiredOn, 10);
  if (acquired !== undefined) {
    if (acquired !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(acquired) || Number.isNaN(Date.parse(acquired))))
      return Response.json({ error: "acquiredOn must be a date, yyyy-mm-dd" }, { status: 400 });
    sets.push("acquired_on = ?");
    values.push(acquired);
  }
  if (body.status !== undefined) {
    if (typeof body.status !== "string" || !STATUSES.has(body.status))
      return Response.json({ error: "status must be alive, gifted or died" }, { status: 400 });
    sets.push("status = ?");
    values.push(body.status);
  }
  if (sets.length === 0) return Response.json({ error: "nothing to change" }, { status: 400 });

  let db;
  try {
    db = openReadWrite();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
  try {
    const r = db.prepare(`UPDATE specimens SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
    if (r.changes === 0) return Response.json({ error: "no such plant" }, { status: 404 });
    const row = db.prepare("SELECT nickname, location, acquired_on, status FROM specimens WHERE id = ?").get(id) as {
      nickname: string | null;
      location: string | null;
      acquired_on: string | null;
      status: string;
    };
    return Response.json({ nickname: row.nickname, location: row.location, acquiredOn: row.acquired_on, status: row.status });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    db.close();
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseId((await ctx.params).id);
  if (!id) return Response.json({ error: "bad id" }, { status: 400 });
  let db;
  try {
    db = openReadWrite();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
  try {
    const sp = db.prepare("SELECT species_id FROM specimens WHERE id = ?").get(id) as { species_id: number } | undefined;
    if (!sp) return Response.json({ error: "no such plant" }, { status: 404 });
    const photos = db.prepare("SELECT path, job_id FROM photos WHERE specimen_id = ?").all(id) as Array<{ path: string; job_id: number | null }>;
    const confirmed = db.prepare("SELECT job_id FROM confirmations WHERE specimen_id = ?").all(id) as Array<{ job_id: number }>;
    const jobIds = [...new Set([...photos.map((p) => p.job_id).filter((j): j is number => j !== null), ...confirmed.map((c) => c.job_id)])];

    db.exec("BEGIN IMMEDIATE");
    db.prepare("DELETE FROM photos WHERE specimen_id = ?").run(id);
    const delJob = db.prepare("DELETE FROM jobs WHERE id = ?"); // candidates and confirmations cascade
    for (const j of jobIds) delJob.run(j);
    db.prepare("DELETE FROM specimens WHERE id = ?").run(id);
    const others = (db.prepare("SELECT COUNT(*) AS n FROM specimens WHERE species_id = ?").get(sp.species_id) as { n: number }).n;
    if (others === 0) db.prepare("DELETE FROM species WHERE id = ?").run(sp.species_id);
    db.exec("COMMIT");

    for (const p of photos) await removeStored(p.path);
    return Response.json({ ok: true, photosRemoved: photos.length, speciesRemoved: others === 0 });
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
