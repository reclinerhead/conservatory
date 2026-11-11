// PATCH /api/todos/:id ticks a to-do off or puts it back (`done`, true or
// false); DELETE takes it off the list for good (#103). Ticking one that is
// already done keeps the day it was first done.

import type { DatabaseSync } from "node:sqlite";
import { openReadWrite } from "@/lib/db";
import { hasTodos } from "@/lib/specimens";
import { doneRequest, todoId } from "@/lib/todos";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Open the database and run `fn` on the to-do the path names, with the answers every verb shares. */
async function withTodo(ctx: Ctx, fn: (db: DatabaseSync, id: number) => Response): Promise<Response> {
  const id = todoId((await ctx.params).id);
  if (!id) return Response.json({ error: "bad id" }, { status: 400 });
  let db;
  try {
    db = openReadWrite();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
  try {
    if (!hasTodos(db)) return Response.json({ error: "Fern has not set up the to-do list yet; restart Fern." }, { status: 503 });
    return fn(db, id);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    db.close();
  }
}

const NONE = () => Response.json({ error: "no such to-do" }, { status: 404 });

export async function PATCH(req: Request, ctx: Ctx) {
  const body = doneRequest(await req.json().catch(() => null));
  if (!body.ok) return Response.json({ error: body.error }, { status: 400 });
  return withTodo(ctx, (db, id) => {
    const r = body.done
      ? db.prepare("UPDATE todos SET completed_at = COALESCE(completed_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE id = ?").run(id)
      : db.prepare("UPDATE todos SET completed_at = NULL WHERE id = ?").run(id);
    if (r.changes === 0) return NONE();
    return Response.json(db.prepare("SELECT id, completed_at AS completedAt FROM todos WHERE id = ?").get(id));
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  return withTodo(ctx, (db, id) => (db.prepare("DELETE FROM todos WHERE id = ?").run(id).changes > 0 ? Response.json({ ok: true }) : NONE()));
}
