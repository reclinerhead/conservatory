// The to-do list (#103), pure: what the three routes must be sent, which
// finding of a health check a to-do copies, the state each finding shows in
// the Health card, and the lists the To-do page, the dashboard and the top
// bar draw. A to-do is the owner's own copy of one finding (fern/db.py v12);
// the web app writes every row. No server imports: client components use this.

import { healthView, type Finding, type HealthRow } from "./health";

export const DONE_SHOWN = 10;
export const DASHBOARD_SHOWN = 3;

const isId = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;

export type AddRequest = { ok: true; checkId: number; finding: number } | { ok: false; error: string };

/** What POST /api/todos must carry: `checkId`, a health check's id, and `finding`, the finding's place in that check from 0. */
export function addRequest(body: unknown): AddRequest {
  const b = (body && typeof body === "object" ? body : {}) as { checkId?: unknown; finding?: unknown };
  if (!isId(b.checkId)) return { ok: false, error: "checkId must be a health check's id" };
  if (!Number.isInteger(b.finding) || (b.finding as number) < 0) return { ok: false, error: "finding must be the finding's place in the check, from 0" };
  return { ok: true, checkId: b.checkId, finding: b.finding as number };
}

export type DoneRequest = { ok: true; done: boolean } | { ok: false; error: string };

/** What PATCH /api/todos/[id] must carry: `done`, true or false. */
export function doneRequest(body: unknown): DoneRequest {
  const done = (body && typeof body === "object" ? (body as { done?: unknown }).done : undefined) as unknown;
  return typeof done === "boolean" ? { ok: true, done } : { ok: false, error: "done must be true or false" };
}

/** A to-do's id from the route's path, or null when it is not one. */
export function todoId(raw: string): number | null {
  const n = Number(raw);
  return /^\d+$/.test(raw) && isId(n) ? n : null;
}

/**
 * The finding a to-do copies: the one at `index` among the findings the
 * Health card draws for this check (`healthView`, which drops any the model
 * left without what it saw or a remedy), so the place the page sends is the
 * place the server reads. Null for a check that is not done or cannot be
 * read, and for a place past the end.
 */
export function findingAt(row: HealthRow, index: number): Finding | null {
  const view = healthView(row);
  if (view.kind !== "done" || !Number.isInteger(index) || index < 0) return null;
  return view.findings[index] ?? null;
}

/** A finding's line in the Health card: not on the list, on it and still to do, or done and when. */
export type FindingTodo = { kind: "none" } | { kind: "pending"; id: number } | { kind: "done"; id: number; completedAt: string };

/** The to-do state of each of a check's findings, in the findings' order, from the to-dos that came from that check. */
export function findingTodos(count: number, todos: Array<{ id: number; findingIndex: number | null; completedAt: string | null }>): FindingTodo[] {
  return Array.from({ length: count }, (_, i): FindingTodo => {
    const t = todos.find((x) => x.findingIndex === i);
    if (!t) return { kind: "none" };
    return t.completedAt ? { kind: "done", id: t.id, completedAt: t.completedAt } : { kind: "pending", id: t.id };
  });
}

type Listed = { id: number; createdAt: string; completedAt: string | null };

/** The to-dos still to do, newest first. */
export function pendingTodos<T extends Listed>(todos: T[]): T[] {
  return todos.filter((t) => !t.completedAt).sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.id - a.id));
}

/** The to-dos that are done, the one done last first. */
export function doneTodos<T extends Listed>(todos: T[]): T[] {
  return todos.filter((t) => t.completedAt).sort((a, b) => (a.completedAt! < b.completedAt! ? 1 : a.completedAt! > b.completedAt! ? -1 : b.id - a.id));
}

/** The dashboard card's rows: the three newest still to do. */
export function latestPending<T extends Listed>(todos: T[], limit = DASHBOARD_SHOWN): T[] {
  return pendingTodos(todos).slice(0, limit);
}

/** The To-do page's counts line: "2 to do · 5 done", zeros included. */
export function countsLine(pending: number, done: number): string {
  return `${pending} to do · ${done} done`;
}
