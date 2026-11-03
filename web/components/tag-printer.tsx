"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { QrIcon, TagCodeSvg } from "@/components/tag-code";
import { LeafMark } from "@/components/topbar";
import { cardNames, dayLabel, groupTiles, locationChips, speciesLabel, TILE_TINTS } from "@/lib/collection";
import type { TagRow } from "@/lib/specimens";
import { clampStart, LABELS_PER_SHEET, nextStart, sheetSlots, type Slot } from "@/lib/tags";

export type PrintRow = TagRow & { code: { size: number; path: string } | null };

// The print page's working parts (#36): which plants, where on the sheet,
// the sheet itself, and "Mark as tagged". Every living plant is on the page
// already with its code, so the chips, the checkboxes and the start label
// lay the sheets out here with no request. The filters live in the URL
// (?at=, ?untagged=1, ?species=, ?plant=), written with the native history
// API as the collection does.
function setTagParams(next: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(next)) {
    if (v === null || v === "" || (k === "at" && v === "all")) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  window.history.replaceState(null, "", url.pathname + url.search);
}

// Where the last marked print stopped, per browser. Storage can be missing
// or refuse (a private window), so every read and write is guarded and the
// page works without it.
const START_KEY = "conservatory.tags.nextStart";

function storedStart(): number | null {
  try {
    const v = window.localStorage.getItem(START_KEY);
    return v ? clampStart(Number(v)) : null;
  } catch {
    return null;
  }
}

function storeStart(k: number) {
  try {
    window.localStorage.setItem(START_KEY, String(k));
  } catch {
    /* the next print starts at label 1 instead */
  }
}

function onStorage(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

type Mark =
  | { kind: "idle" }
  | { kind: "ask"; ids: number[]; start: number }
  | { kind: "saving"; ids: number[]; start: number }
  | { kind: "done"; marked: number; next: number }
  | { kind: "error"; ids: number[]; start: number; message: string };

export function TagPrinter({ rows, hasBase }: { rows: PrintRow[]; hasBase: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const plantId = Number(params.get("plant")) || null;
  const speciesId = Number(params.get("species")) || null;
  const untaggedOnly = params.get("untagged") === "1";

  const narrowed = rows.filter((r) => (plantId === null || r.id === plantId) && (speciesId === null || r.speciesId === speciesId));
  const chips = locationChips(narrowed);
  const at = params.get("at") ?? "all";
  const where = chips.some((c) => c.key === at) ? at : "all";
  const untaggedCount = narrowed.filter((r) => !r.taggedAt).length;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const groups = groupTiles(
    narrowed.filter((r) => !untaggedOnly || !r.taggedAt),
    { where },
  ).map((g) => ({ ...g, rows: g.tiles.map((t) => byId.get(t.id)!) }));
  const shown = groups.flatMap((g) => g.rows);

  // On arrival the untagged plants on screen are checked; a plant asked for
  // by name (?plant=, "Print this tag") is checked whatever its state.
  const [checked, setChecked] = useState<Set<number>>(() => new Set(shown.filter((r) => plantId !== null || !r.taggedAt).map((r) => r.id)));
  const [picked, setPicked] = useState<number | null>(null);
  const remembered = useSyncExternalStore(onStorage, storedStart, () => null);
  const start = picked ?? remembered ?? 1;
  const [mark, setMark] = useState<Mark>({ kind: "idle" });

  // What prints is what is checked and on screen, in the list's order.
  const toPrint = shown.filter((r) => checked.has(r.id));
  const n = toPrint.length;
  const sheets: Slot[][] =
    n > 0 ? sheetSlots(n, start) : [Array.from({ length: LABELS_PER_SHEET }, (_, i): Slot => ({ kind: i < start - 1 ? "used" : "blank" }))];

  // The page cannot tell a printed sheet from a cancelled dialog (afterprint
  // fires for both), so once the dialog closes it asks. What it asks about is
  // what was on the sheet when the dialog opened, Ctrl+P included.
  const printIds = toPrint.map((r) => r.id).join(",");
  useEffect(() => {
    if (!printIds) return;
    const ids = printIds.split(",").map(Number);
    const after = () => setMark({ kind: "ask", ids, start });
    window.addEventListener("afterprint", after);
    return () => window.removeEventListener("afterprint", after);
  }, [printIds, start]);

  function toggle(id: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function checkShown(on: boolean) {
    setChecked((prev) => {
      const next = new Set(prev);
      for (const r of shown) {
        if (on) next.add(r.id);
        else next.delete(r.id);
      }
      return next;
    });
  }

  async function markTagged(ids: number[], from: number) {
    setMark({ kind: "saving", ids, start: from });
    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const body = (await res.json().catch(() => ({}))) as { marked?: number; error?: string };
      if (!res.ok) throw new Error(body.error ?? `server ${res.status}`);
      const next = nextStart(from, ids.length);
      storeStart(next);
      setPicked(next);
      setMark({ kind: "done", marked: body.marked ?? 0, next });
      router.refresh();
    } catch (err) {
      setMark({ kind: "error", ids, start: from, message: (err as Error).message });
    }
  }

  const narrowName = plantId !== null ? (narrowed[0] ? cardNames(narrowed[0]).name : null) : speciesId !== null && narrowed[0] ? speciesLabel(narrowed[0].scientificName, narrowed[0].cultivar) : null;
  const allShownChecked = shown.length > 0 && shown.every((r) => checked.has(r.id));

  return (
    <div className="flex flex-wrap items-start gap-7">
      {/* Which plants: the collection's location chips, "Not tagged yet", and one row per living plant. */}
      <section aria-labelledby="which-h" className="flex min-w-0 flex-[1_1_440px] flex-col gap-4">
        <h2 id="which-h" className="text-h3">
          Which plants
        </h2>

        {plantId !== null || speciesId !== null ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-tile bg-sage px-4 py-2.5">
            <p className="min-w-0 flex-1 text-body">
              {plantId !== null ? "Only " : "Only plants of "}
              {narrowName ? <span className={plantId === null ? "italic" : "font-semibold"}>{narrowName}</span> : <span>one {plantId !== null ? "plant" : "species"}</span>}
            </p>
            <button type="button" onClick={() => setTagParams({ plant: null, species: null })} className="btn btn-ghost btn-compact">
              Show every plant
            </button>
          </div>
        ) : null}

        <div role="group" aria-label="Filter the plants" className="flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-pressed={where === c.key}
              onClick={() => setTagParams({ at: c.key })}
              className={`chip chip-compact ${where === c.key ? "chip-on" : ""}`}
            >
              {c.label}
              <span className="font-normal opacity-80 tabular-nums">{c.n}</span>
            </button>
          ))}
          <span aria-hidden className="mx-1 h-6 w-px bg-line-2" />
          <button
            type="button"
            aria-pressed={untaggedOnly}
            onClick={() => setTagParams({ untagged: untaggedOnly ? null : "1" })}
            className={`chip chip-compact ${untaggedOnly ? "chip-on" : ""}`}
          >
            Not tagged yet
            <span className="font-normal opacity-80 tabular-nums">{untaggedCount}</span>
          </button>
        </div>

        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line bg-ground px-4 py-2 sm:px-5">
            <p className="text-meta font-semibold text-ink-2 tabular-nums">
              {n} of {plural(shown.length, "plant")} checked
            </p>
            <button
              type="button"
              disabled={shown.length === 0}
              onClick={() => checkShown(!allShownChecked)}
              className="btn btn-ghost btn-compact"
            >
              {allShownChecked ? "Uncheck all" : "Check all"}
            </button>
          </div>

          {shown.length === 0 ? (
            <div className="flex min-h-[160px] flex-col items-start justify-center gap-1.5 px-5 py-6">
              <p className="text-lead font-bold">{rows.length === 0 ? "No living plants to tag yet" : "No plants here"}</p>
              <p className="text-meta text-ink-2">
                {rows.length === 0
                  ? "Every plant you add gets a tag of its own here."
                  : untaggedOnly
                    ? "Every plant here already has its tag."
                    : "Pick another place, or show every plant."}
              </p>
              {rows.length > 0 ? (
                <button type="button" onClick={() => setTagParams({ at: "all", untagged: null, plant: null, species: null })} className="btn btn-soft btn-compact mt-2">
                  Show every plant
                </button>
              ) : null}
            </div>
          ) : (
            <ul>
              {groups.map((g) => (
                <li key={g.key}>
                  <p className="flex items-baseline gap-2 border-b border-line bg-ground px-4 py-1.5 text-meta font-semibold text-ink-2 sm:px-5">
                    {g.label}
                    <span className="font-normal tabular-nums">{g.rows.length}</span>
                  </p>
                  <ul className="divide-y divide-line">
                    {g.rows.map((r, i) => {
                      const { name, species } = cardNames(r);
                      const state = r.taggedAt ? `Tagged ${dayLabel(r.taggedAt)}` : "No tag yet";
                      return (
                        <li key={r.id}>
                          <label className="flex min-h-[76px] cursor-pointer items-center gap-3 py-2.5 pl-1.5 pr-4 transition-colors hover:bg-ground sm:pr-5">
                            <span className="flex h-11 w-11 flex-none items-center justify-center">
                              <input type="checkbox" checked={checked.has(r.id)} onChange={() => toggle(r.id)} className="h-5 w-5 accent-moss" />
                            </span>
                            {r.thumbUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={r.thumbUrl} alt="" loading="lazy" width={56} height={56} className="h-14 w-14 flex-none rounded-thumb object-cover" />
                            ) : (
                              <span aria-hidden className={`flex h-14 w-14 flex-none items-center justify-center rounded-thumb ${TILE_TINTS[i % TILE_TINTS.length]}`}>
                                <LeafMark size={28} className="text-[#6B8F66]" />
                              </span>
                            )}
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className={`truncate text-lead font-bold leading-snug ${species ? "" : "italic"}`}>{name}</span>
                              {species ? <span className="sp truncate">{species}</span> : null}
                              <span className="text-meta text-ink-2 tabular-nums">
                                {r.location ? `${r.location} · ` : ""}#{r.id}
                                <span className="sm:hidden"> · {state}</span>
                              </span>
                            </span>
                            <span className="hidden w-44 flex-none text-right sm:block">
                              {r.taggedAt ? <span className="tag whitespace-nowrap">{state}</span> : <span className="text-meta text-ink-2">{state}</span>}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* The sheet: print it, mark it, choose where it starts, and see it. */}
      <section aria-labelledby="sheet-h" className="flex min-w-0 flex-[1_1_520px] flex-col gap-5">
        <h2 id="sheet-h" className="sr-only">
          The sheet
        </h2>
        <div className="card flex flex-col gap-3 p-5">
          <p className="text-lead font-bold tabular-nums">
            {n === 0
              ? "Nothing checked yet"
              : n === 1
                ? `1 tag, on label ${start}`
                : `${plural(n, "tag")}, from label ${start}${sheets.length > 1 ? ` onto ${sheets.length} sheets` : ` to ${start + n - 1}`}`}
          </p>
          <button
            type="button"
            disabled={n === 0 || !hasBase}
            onClick={() => window.print()}
            className="btn btn-primary self-start"
          >
            <QrIcon />
            {n === 0 ? "Print tags" : `Print ${plural(n, "tag")} on ${plural(sheets.length, "sheet")}`}
          </button>
          <p className="min-h-[3.75rem] text-meta text-ink-2">
            {hasBase ? (
              <>
                Print at 100%, not &ldquo;fit to page&rdquo;, with margins set to none. The first time, print on plain paper and hold it
                against a label sheet up to the light.
              </>
            ) : (
              <>
                No codes yet: every tag carries the address in <code className="font-semibold text-ink">CONSERVATORY_URL</code>, and it
                is not set. Add it to the environment file and restart the web app.
              </>
            )}
          </p>

          {/* Mark as tagged. Its space is always kept, so the strip appearing moves nothing. */}
          <div aria-live="polite" className="flex min-h-[104px] flex-col justify-center gap-2 rounded-tile bg-sage px-4 py-3">
            {mark.kind === "ask" || mark.kind === "saving" || mark.kind === "error" ? (
              <>
                <p className="text-body font-semibold">
                  {mark.kind === "error" ? `Could not mark them: ${mark.message}` : `Did they print? Mark ${mark.ids.length === 1 ? "this one" : `these ${mark.ids.length}`} as tagged.`}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={mark.kind === "saving"} onClick={() => markTagged(mark.ids, mark.start)} className="btn btn-primary btn-compact">
                    {mark.kind === "saving" ? "Marking…" : mark.kind === "error" ? "Try again" : "Mark as tagged"}
                  </button>
                  <button type="button" disabled={mark.kind === "saving"} onClick={() => setMark({ kind: "idle" })} className="btn btn-ghost btn-compact">
                    Not now
                  </button>
                </div>
              </>
            ) : mark.kind === "done" ? (
              <p className="text-body">
                <span className="font-semibold">Marked {plural(mark.marked, "plant")} as tagged.</span> The next print starts at label {mark.next}.
              </p>
            ) : (
              <p className="text-meta text-ink-2">
                Once the print dialog closes, this asks whether the tags came out, so the plants on the sheet can be marked as tagged.
              </p>
            )}
          </div>
        </div>

        <div className="card flex flex-col gap-3 p-5">
          <h3 className="text-h3 tabular-nums">Start at label {start}</h3>
          <p className="text-meta text-ink-2">
            {picked === null && remembered !== null
              ? "Where your last print stopped. Tap another label if the sheet in the printer differs."
              : "For a partly used sheet, tap its first free label. The ones before it are left alone."}
          </p>
          <div role="group" aria-label="First free label on the sheet" className="grid grid-cols-3 gap-1.5">
            {Array.from({ length: LABELS_PER_SHEET }, (_, i) => {
              const k = i + 1;
              const used = k < start;
              const filled = !used && k < start + n;
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={k === start}
                  aria-label={`Start at label ${k}`}
                  onClick={() => setPicked(k)}
                  className={`flex min-h-[44px] items-center justify-center rounded-[8px] border text-meta tabular-nums transition-colors ${
                    k === start
                      ? "border-moss bg-moss font-bold text-white"
                      : used
                        ? "border-line bg-sage text-ink-3 line-through hover:bg-sage-2"
                        : filled
                          ? "border-line-strong bg-sage-2 font-semibold text-ink hover:bg-sage"
                          : "border-line-2 bg-surface text-ink-2 hover:bg-sage"
                  }`}
                >
                  {k}
                </button>
              );
            })}
          </div>
          <p className="text-meta text-ink-2">
            <span className="mr-1.5 inline-block h-3 w-3 rounded-[3px] border border-line bg-sage align-[-1px]" /> used{" "}
            <span className="ml-3 mr-1.5 inline-block h-3 w-3 rounded-[3px] border border-line-strong bg-sage-2 align-[-1px]" /> this print
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-h3">The sheet the printer gets</h3>
          <p className="text-meta text-ink-2">Thirty 1&Prime; &times; 2&#8541;&Prime; labels to a letter sheet (Avery 5160, or its weatherproof twin), shown to scale.</p>
          <div className="label-sheets mt-1">
            {sheets.map((sheet, s) => [
              sheets.length > 1 ? (
                <p key={`cap-${s}`} className="text-meta font-semibold text-ink-2 print:hidden">
                  Sheet {s + 1} of {sheets.length}
                </p>
              ) : null,
              <div key={`sheet-${s}`} className="label-sheet">
                {sheet.map((slot, i) =>
                  slot.kind === "tag" ? (
                    <PotLabel key={i} row={toPrint[slot.index]} />
                  ) : (
                    <div key={i} aria-hidden className={`label ${slot.kind === "used" ? "label-used" : ""}`} />
                  ),
                )}
              </div>,
            ])}
          </div>
        </div>
      </section>
    </div>
  );
}

/** One label: the code at the left, then the card's name, the italic species, and "Shelf 2 · #142". */
function PotLabel({ row }: { row: PrintRow }) {
  const { name, species } = cardNames(row);
  return (
    <div className="label">
      {row.code ? (
        <TagCodeSvg code={row.code} label={`QR code for plant #${row.id}`} className="label-code" />
      ) : (
        <div className="label-code label-code-missing">
          <span>No CONSERVATORY_URL</span>
        </div>
      )}
      <div className="label-text">
        <p className={`label-name ${species ? "" : "italic"}`}>{name}</p>
        {species ? <p className="label-species">{species}</p> : null}
        <p className="label-meta">{row.location ? `${row.location} · #${row.id}` : `#${row.id}`}</p>
      </div>
    </div>
  );
}
