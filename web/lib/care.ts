// The care sheet on the species page, pure: what the stored row says, read
// defensively, and which of its states the page is in. Fern writes the sheet
// (fern/care.py, schema v3); the web app reads it and never calls a model.

import { dayLabel } from "./collection";
import type { GlossaryKey } from "./glossary";

export type CareFigure = { label: string; value: string; basis: string };
export type CareCell = { headline: string; text: string; figures: CareFigure[] };

/** The mockup's six cells, in its order, each with its label and glossary term. */
export const CARE_CELLS = [
  { key: "light", label: "Light", term: "light" },
  { key: "water", label: "Water", term: "watering" },
  { key: "soil", label: "Soil", term: "soil" },
  { key: "hardiness", label: "Hardiness", term: "hardiness" },
  { key: "fertilizing", label: "Fertilizing", term: "fertilizing" },
  { key: "dormancy", label: "Dormancy", term: "dormancy" },
] as const satisfies ReadonlyArray<{ key: string; label: string; term: GlossaryKey }>;

export type CareKey = (typeof CARE_CELLS)[number]["key"];
export type CareCells = Record<CareKey, CareCell>;

/** The row as the species read hands it over, columns as stored. */
export type CareRow = {
  zone: string | null;
  model: string | null;
  cells: string | null;
  notes: string | null;
  writtenAt: string | null;
  triedAt: string;
  error: string | null;
};

export type CareState =
  | {
      kind: "sheet";
      cells: CareCells;
      level: "species" | "genus";
      subject: string | null;
      zone: string | null;
      model: string | null;
      writtenAt: string | null;
      lastTryFailed: boolean; // a rewrite failed; the sheet shown is the one before it
    }
  | { kind: "writing" } // a model is configured and the species is placed: Fern writes it on an idle tick
  | { kind: "failed"; error: string; triedAt: string } // no sheet yet and the last try failed; Fern tries again a day later
  | { kind: "unplaced"; enriched: boolean } // GBIF has not placed the species (yet), so there is nothing to write from
  | { kind: "off" }; // no model is configured on this box

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The stored cells JSON -> the six cells, or null when any cell is missing or malformed. Fern validated it; this only refuses to render junk. */
export function parseCells(json: string | null): CareCells | null {
  if (!json) return null;
  let body: unknown;
  try {
    body = JSON.parse(json);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object") return null;
  const out: Partial<CareCells> = {};
  for (const { key } of CARE_CELLS) {
    const c = (body as Record<string, unknown>)[key] as Record<string, unknown> | undefined;
    const headline = str(c?.headline);
    const text = str(c?.text);
    if (!headline || !text) return null;
    const figures = (Array.isArray(c?.figures) ? c.figures : []).flatMap((f: unknown) => {
      const r = f as Record<string, unknown> | null;
      const label = str(r?.label);
      const value = str(r?.value);
      const basis = str(r?.basis);
      return label && value && basis ? [{ label, value, basis }] : [];
    });
    out[key] = { headline, text, figures };
  }
  return out as CareCells;
}

/** What the care block shows. A written sheet always shows, whatever else is true; otherwise the reason there is none. */
export function careState(input: { row: CareRow | null; configured: boolean; gbifKey: number | null; enrichedAt: string | null }): CareState {
  const { row, configured } = input;
  const cells = parseCells(row?.cells ?? null);
  if (row && cells) {
    let notes: Record<string, unknown> = {};
    try {
      notes = JSON.parse(row.notes ?? "{}") ?? {};
    } catch {
      /* the notes are a bonus */
    }
    return {
      kind: "sheet",
      cells,
      level: notes.level === "genus" ? "genus" : "species",
      subject: str(notes.subject),
      zone: row.zone,
      model: row.model,
      writtenAt: row.writtenAt,
      lastTryFailed: row.error !== null,
    };
  }
  if (!configured) return { kind: "off" };
  if (input.gbifKey === null) return { kind: "unplaced", enriched: input.enrichedAt !== null };
  if (row?.error) return { kind: "failed", error: row.error, triedAt: row.triedAt };
  return { kind: "writing" };
}

/** "anthropic/claude-sonnet-5.5" -> "Claude Sonnet 5.5". */
export function modelLabel(slug: string | null): string {
  const name = (slug ?? "").split("/").pop() ?? "";
  if (!name) return "a language model";
  return name
    .split("-")
    .map((w) => (/^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** The line under the heading: which zone the sheet was written for, and at what level. */
export function careScopeLine(s: Extract<CareState, { kind: "sheet" }>): string {
  const zone = s.zone ? `For zone ${s.zone}` : "No household zone set";
  return s.level === "genus" && s.subject ? `${zone} · written for the genus ${s.subject}` : `${zone} · written once for this species`;
}

/** The provenance line at the foot of a written sheet. */
export function careWrittenLine(s: Extract<CareState, { kind: "sheet" }>): string {
  const day = dayLabel(s.writtenAt);
  return `Written by ${modelLabel(s.model)}${day ? ` on ${day}` : ""} from GBIF's taxonomy and Wikipedia's summary`;
}
