// A plant's health checks (#87), pure: which photos are chosen to begin
// with, the one-to-three limit, what a request must carry, whether a request
// repeats the last check, the household's daily cap, and the shape a stored
// check takes on the page. Fern asks the model and writes the row
// (fern/health.py); the route and the components only read and queue. No
// server imports: the plant page's client components use this.

import { localDay } from "./dashboard";

export const MAX_PHOTOS = 3;
export const MAX_QUESTION = 500;
export const DEFAULT_DAILY_MAX = 20;
export const EARLIER_SHOWN = 5;

export type HealthStatus = "healthy" | "watch" | "needs_attention" | "cannot_tell";
export type CheckState = "queued" | "running" | "done" | "failed";

/** The tag's words for each status. */
export const STATUS_LABEL: Record<HealthStatus, string> = {
  healthy: "Looks healthy",
  watch: "Keep an eye on it",
  needs_attention: "Needs attention",
  cannot_tell: "Can't tell from these",
};

type Dated = { id: number; takenAt: string | null; uploadedAt: string };

/** A plant's photos newest first: by when each was taken (upload time when the photo carried no date), then id. The picker's order. */
export function newestFirst<T extends Dated>(photos: T[]): T[] {
  const when = (p: Dated) => p.takenAt ?? p.uploadedAt;
  return [...photos].sort((a, b) => (when(a) < when(b) ? 1 : when(a) > when(b) ? -1 : b.id - a.id));
}

/** The photos chosen to begin with: the three newest, or all of them when the plant has fewer. */
export function defaultSelection(photos: Dated[]): number[] {
  return newestFirst(photos)
    .slice(0, MAX_PHOTOS)
    .map((p) => p.id);
}

/** Tick or untick a photo. A fourth is not added; the last can be unticked, and then the button is off. */
export function togglePhoto(selected: number[], id: number): number[] {
  if (selected.includes(id)) return selected.filter((x) => x !== id);
  return selected.length >= MAX_PHOTOS ? selected : [...selected, id];
}

/** Whether the choice can be sent: one to three photos. */
export function canSend(selected: number[]): boolean {
  return selected.length >= 1 && selected.length <= MAX_PHOTOS;
}

/**
 * What the owner may say about the plant when starting a check (#99), both
 * optional: whether it grows indoors or outdoors, and whether its light is
 * natural or artificial. In the order the card draws them.
 */
export const SETTINGS = ["indoors", "outdoors"] as const;
export const LIGHTS = ["natural", "artificial"] as const;
export type Setting = (typeof SETTINGS)[number];
export type Light = (typeof LIGHTS)[number];

export type CheckRequest = { ok: true; photoIds: number[]; question: string | null; setting: Setting | null; light: Light | null } | { ok: false; error: string };

/**
 * What POST /api/plants/[id]/health must carry: `photoIds`, one to three
 * distinct positive integers, and optionally `question`, text of at most 500
 * characters once trimmed (empty means none), `setting` (indoors or outdoors)
 * and `light` (natural or artificial); either left out or null means the
 * owner did not say.
 */
export function checkRequest(body: unknown): CheckRequest {
  const b = (body && typeof body === "object" ? body : {}) as { photoIds?: unknown; question?: unknown; setting?: unknown; light?: unknown };
  const ids = b.photoIds;
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: "choose at least one photo" };
  if (!ids.every((n) => Number.isInteger(n) && (n as number) > 0)) return { ok: false, error: "photoIds must be photo ids" };
  const photoIds = [...new Set(ids as number[])];
  if (photoIds.length > MAX_PHOTOS) return { ok: false, error: `choose at most ${MAX_PHOTOS} photos` };
  if (b.question !== undefined && b.question !== null && typeof b.question !== "string") return { ok: false, error: "question must be text" };
  const question = (b.question ?? "").trim();
  if (question.length > MAX_QUESTION) return { ok: false, error: `the question is at most ${MAX_QUESTION} characters` };
  const setting = b.setting ?? null;
  if (setting !== null && !SETTINGS.includes(setting as Setting)) return { ok: false, error: "setting must be indoors or outdoors" };
  const light = b.light ?? null;
  if (light !== null && !LIGHTS.includes(light as Light)) return { ok: false, error: "light must be natural or artificial" };
  return { ok: true, photoIds, question: question || null, setting: setting as Setting | null, light: light as Light | null };
}

/**
 * Whether a request repeats a check: the same photos, in any order, the same
 * question once trimmed, and the same setting and light (#99; saying where
 * the plant grows is a new thing to ask). The route refuses a repeat of the
 * plant's last finished check, whose result is already on the page.
 */
export function sameAsLast(
  last: { photoIds: number[]; question: string | null; setting?: string | null; light?: string | null } | null,
  photoIds: number[],
  question: string | null,
  setting: string | null = null,
  light: string | null = null,
): boolean {
  if (!last) return false;
  if ((last.setting ?? null) !== setting || (last.light ?? null) !== light) return false;
  const a = [...new Set(last.photoIds)].sort((x, y) => x - y);
  const b = [...new Set(photoIds)].sort((x, y) => x - y);
  if (a.length !== b.length || a.some((x, i) => x !== b[i])) return false;
  return (last.question ?? "").trim() === (question ?? "").trim();
}

/** CONSERVATORY_HEALTH_DAILY_MAX as a whole number of checks a day; the default when unset or not one. Zero is allowed and turns checks off. */
export function dailyMax(raw: string | undefined): number {
  const t = (raw ?? "").trim();
  return /^\d+$/.test(t) ? Number(t) : DEFAULT_DAILY_MAX;
}

/** How many of these checks were started today, by the station's own calendar (the day turns at local midnight). */
export function checksToday(createdAts: string[], now: Date): number {
  const today = localDay(now);
  return createdAts.filter((t) => {
    const d = new Date(t);
    return !Number.isNaN(d.getTime()) && localDay(d) === today;
  }).length;
}

/** Whether the household has reached the day's cap. */
export function capReached(createdAts: string[], now: Date, max: number): boolean {
  return checksToday(createdAts, now) >= max;
}

// --- a stored check, as the page shows it -----------------------------------

/** A `health_checks` row as the database gives it. */
export type HealthRow = {
  id: number;
  state: CheckState;
  photo_ids: string;
  question: string | null;
  status: string | null;
  summary: string | null;
  answer: string | null;
  model: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
};

export type Finding = { seen: string; photo: number | null; likelihood: "likely" | "possible"; remedy: string };

type Base = { id: number; createdAt: string; finishedAt: string | null; photoIds: number[]; question: string | null };

export type HealthView = Base &
  (
    | { kind: "waiting" } // queued or running: Fern is looking
    | { kind: "failed"; why: string }
    | {
        kind: "done";
        status: HealthStatus;
        summary: string;
        reply: string | null;
        findings: Finding[];
        confidence: { level: "high" | "medium" | "low"; why: string } | null;
        nextPhotos: string[];
        model: string | null;
      }
  );

const STATUSES: HealthStatus[] = ["healthy", "watch", "needs_attention", "cannot_tell"];

function parseIds(raw: string): number[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n) && n > 0) : [];
  } catch {
    return [];
  }
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Why a check failed, in plain words. Fern stores "<Kind>: <its words>"
 * (fern/health.py); the kind picks the sentence and the gateway's own words
 * are kept, since each names a different thing to go and fix.
 */
export function failureWords(error: string | null): string {
  const e = (error ?? "").trim();
  const rest = e.replace(/^[A-Za-z]+:\s*/, "");
  if (e.startsWith("LlmError:")) return `Fern couldn't get an answer from the model: ${rest}.`;
  if (e.startsWith("InvalidAnswer:")) return `The model answered, but not in a form Fern could use (${rest}), so nothing was saved.`;
  if (e.startsWith("LookupError:")) return "The photos chosen for this check were removed before Fern could look at them.";
  if (e.startsWith("Interrupted:")) return "Fern was restarted while it was looking.";
  if (e.startsWith("Off:")) return "Health checks are off on this box: Fern has no model key.";
  return e ? `Something went wrong before Fern could finish: ${rest || e}.` : "Something went wrong before Fern could finish.";
}

/** A stored check in the shape its row on the page takes: waiting, failed with its reason, or done with what the model said. */
export function healthView(row: HealthRow): HealthView {
  const base: Base = { id: row.id, createdAt: row.created_at, finishedAt: row.finished_at, photoIds: parseIds(row.photo_ids), question: text(row.question) };
  if (row.state === "queued" || row.state === "running") return { ...base, kind: "waiting" };
  if (row.state === "failed") return { ...base, kind: "failed", why: failureWords(row.error) };

  let answer: Record<string, unknown> | null = null;
  try {
    const v: unknown = JSON.parse(row.answer ?? "");
    if (v && typeof v === "object" && !Array.isArray(v)) answer = v as Record<string, unknown>;
  } catch {
    /* below */
  }
  const status = STATUSES.find((s) => s === row.status);
  const summary = text(row.summary);
  if (!answer || !status || !summary) return { ...base, kind: "failed", why: "This check's result could not be read back." };

  const findings: Finding[] = (Array.isArray(answer.findings) ? answer.findings : []).flatMap((f: unknown) => {
    const o = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
    const seen = text(o.seen);
    const remedy = text(o.remedy);
    if (!seen || !remedy) return [];
    return [{ seen, remedy, photo: Number.isInteger(o.photo) ? (o.photo as number) : null, likelihood: o.likelihood === "likely" ? "likely" : "possible" }];
  });
  const c = (answer.confidence && typeof answer.confidence === "object" ? answer.confidence : {}) as Record<string, unknown>;
  const level = c.level === "high" || c.level === "medium" || c.level === "low" ? c.level : null;
  return {
    ...base,
    kind: "done",
    status,
    summary,
    reply: base.question ? text(answer.reply) : null,
    findings,
    confidence: level ? { level, why: text(c.why) ?? "" } : null,
    nextPhotos: (Array.isArray(answer.next_photos) ? answer.next_photos : []).flatMap((p: unknown) => text(p) ?? []),
    model: text(row.model),
  };
}
