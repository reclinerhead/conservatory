// Pot tags (#36), pure: the address a tag encodes, the code drawn as one SVG
// path, and how a run of labels lays out on the stock, the 30-up 1″ × 2⅝″
// address label (the Avery 5160 layout). The server makes the codes
// (lib/tag-code.ts); the print page (components/tag-printer.tsx) lays out
// sheets here on every tap, so nothing in this file may import the QR
// library.

/** Labels on one sheet: 3 across, 10 down. */
export const LABELS_PER_SHEET = 30;
export const SHEET_COLUMNS = 3;

/**
 * A tag's address, `<base>/t/<id>`, from CONSERVATORY_URL. Null when the
 * base is unset or not an http(s) address: no code is drawn without one,
 * because a printed label lasts years and must never carry a guess.
 */
export function tagUrl(base: string | null | undefined, id: number): string | null {
  const b = (base ?? "").trim().replace(/\/+$/, "");
  if (!b) return null;
  try {
    const u = new URL(b);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return `${b}/t/${id}`;
}

/**
 * The code's dark modules as one SVG path in module units, a rectangle per
 * horizontal run, for `viewBox="0 0 size size"`. `data` is row-major, as the
 * QR library's BitMatrix stores it.
 */
export function codePath(m: { size: number; data: ArrayLike<number> }): string {
  let d = "";
  for (let y = 0; y < m.size; y++) {
    let x = 0;
    while (x < m.size) {
      if (!m.data[y * m.size + x]) {
        x++;
        continue;
      }
      const from = x;
      while (x < m.size && m.data[y * m.size + x]) x++;
      d += `M${from} ${y}h${x - from}v1h-${x - from}z`;
    }
  }
  return d;
}

/** A start label from 1 to 30; anything else is clamped, and a non-number starts at 1. */
export function clampStart(k: number): number {
  if (!Number.isFinite(k)) return 1;
  return Math.min(LABELS_PER_SHEET, Math.max(1, Math.trunc(k)));
}

/** One label on a sheet: one already used on a partly used sheet, the tag at `index` in the print, or left blank. */
export type Slot = { kind: "used" } | { kind: "tag"; index: number } | { kind: "blank" };

/**
 * `n` tags starting at label `start`, sheet by sheet: start − 1 used labels,
 * then the tags in order, flowing onto further sheets, then blanks to the end
 * of the last sheet. No tags, no sheets.
 */
export function sheetSlots(n: number, start: number): Slot[][] {
  if (!(n > 0)) return [];
  const skip = clampStart(start) - 1;
  const end = skip + n;
  const sheets = Math.ceil(end / LABELS_PER_SHEET);
  return Array.from({ length: sheets }, (_, s) =>
    Array.from({ length: LABELS_PER_SHEET }, (_, i): Slot => {
      const at = s * LABELS_PER_SHEET + i;
      if (at < skip) return { kind: "used" };
      if (at < end) return { kind: "tag", index: at - skip };
      return { kind: "blank" };
    }),
  );
}

/** Where the next print starts once these `n` are marked as tagged: the label after the last one, wrapping after 30. */
export function nextStart(start: number, n: number): number {
  return ((clampStart(start) - 1 + Math.max(0, Math.trunc(n))) % LABELS_PER_SHEET) + 1;
}
