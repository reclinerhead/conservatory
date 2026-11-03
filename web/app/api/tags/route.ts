// POST /api/tags: "Mark as tagged" on the print page. Body `{ ids }`, the
// plants whose tags the person says printed. Stamps `tagged_at` on those of
// them still living (schema v5) and returns how many. The page cannot tell a
// printed sheet from a cancelled dialog, so this is only ever the person's
// answer, never the print itself.

import { openReadWrite } from "@/lib/db";

export const dynamic = "force-dynamic";

/** At most one print run's worth: 20 sheets. */
const MAX_IDS = 600;

export async function POST(req: Request) {
  let body: { ids?: unknown };
  try {
    body = (await req.json()) as { ids?: unknown };
  } catch {
    return Response.json({ error: "expected json" }, { status: 400 });
  }
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS || !ids.every((v) => Number.isInteger(v) && v > 0))
    return Response.json({ error: `ids must be 1 to ${MAX_IDS} plant ids` }, { status: 400 });

  let db;
  try {
    db = openReadWrite();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
  try {
    const r = db
      .prepare(
        `UPDATE specimens SET tagged_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE status = 'alive' AND id IN (SELECT value FROM json_each(?))`,
      )
      .run(JSON.stringify(ids));
    return Response.json({ marked: Number(r.changes) });
  } catch (err) {
    // Before Fern has migrated to v5 there is no tagged_at column to stamp.
    return Response.json({ error: (err as Error).message }, { status: 503 });
  } finally {
    db.close();
  }
}
