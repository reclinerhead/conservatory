"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSyncExternalStore } from "react";
import { LeafMark } from "@/components/topbar";
import { displayName, speciesLabel, TILE_TINTS } from "@/lib/collection";
import { gridRows, placeChips, readSort, selectedPlace, showingSpecies, SORTS, tileLine, type Sort } from "@/lib/species-grid";
import { speciesTitle, type SpeciesListRow } from "@/lib/species-page";

// The home page's species grid: one tile per species, each opening its
// species page, filtered by a row of place chips and the top bar's search.
// Every row is on the page already (sixty species is a few kilobytes), so
// both filter here, on the phone, with no request. Both live in the URL
// (?q= and ?at=), written with the native history API so the back button
// returns to the same view and the top bar's box and this grid agree.
function setGridParams(next: { q?: string; at?: string }) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined) continue;
    if (v === "" || (k === "at" && v === "all")) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  window.history.replaceState(null, "", url.pathname + url.search);
}

// The grid's order is the household's choice on this device, so it lives in
// localStorage rather than the URL: it survives a reload and a new session.
// One small store that the Sort by select and the grid both read, so they
// agree without sharing a parent. The server draws the default (name); a
// stored "latest" takes over on hydration. Storage can be blocked (a private
// window, cleared site data), so every access is guarded and the choice is
// kept in memory too, which holds for the visit.
const SORT_KEY = "conservatory.sort";
const sortListeners = new Set<() => void>();
let sortThisVisit: Sort | null = null;

function subscribeSort(cb: () => void) {
  sortListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    sortListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function storedSort(): Sort {
  try {
    const v = window.localStorage.getItem(SORT_KEY);
    if (v !== null) return readSort(v);
  } catch {
    // Storage blocked: fall through to this visit's choice.
  }
  return sortThisVisit ?? "name";
}

function chooseSort(s: Sort) {
  sortThisVisit = s;
  try {
    window.localStorage.setItem(SORT_KEY, s);
  } catch {
    // Storage blocked: the choice holds for this visit only.
  }
  for (const cb of sortListeners) cb();
}

function useSort(): Sort {
  return useSyncExternalStore(subscribeSort, storedSort, () => "name");
}

/**
 * "Sort by" in the life list's header, the Quarry's select: a native
 * <select> with a drawn chevron. Every label sits invisible in the same grid
 * cell, so the control is as wide as the longest and choosing moves nothing.
 */
export function SortSelect() {
  const sort = useSort();
  return (
    <div className="flex items-center gap-2.5">
      <label htmlFor="sort" className="text-meta font-bold text-ink-2">
        Sort by
      </label>
      <div className="relative grid">
        {SORTS.map((s) => (
          <span key={s.key} aria-hidden className="select invisible col-start-1 row-start-1 h-0 min-h-0 border-y-0">
            {s.label}
          </span>
        ))}
        <select id="sort" value={sort} onChange={(e) => chooseSort(readSort(e.target.value))} className="select col-start-1 row-start-1">
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <svg
          aria-hidden
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none absolute right-3.5 top-3 text-ink-2"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>
    </div>
  );
}

export function SpeciesGrid({ rows }: { rows: SpeciesListRow[] }) {
  const params = useSearchParams();
  const sort = useSort();
  const q = params.get("q") ?? "";
  const chips = placeChips(rows);
  const at = selectedPlace(chips, params.get("at"));
  const shown = gridRows(rows, { q, at, sort });
  const total = chips.find((c) => c.key === at)?.n ?? 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Filter row: chips wrap, never scroll sideways; counts are from the whole list. */}
      <div role="group" aria-label="Filter by place" className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={at === c.key}
            onClick={() => setGridParams({ at: c.key })}
            className={`chip chip-compact ${at === c.key ? "chip-on" : ""}`}
          >
            {c.label}
            <span className="font-normal opacity-80 tabular-nums">{c.n}</span>
          </button>
        ))}
      </div>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.length === 0 ? (
          <>
            <li className="card flex flex-col overflow-hidden">
              <div className={`flex h-[168px] items-center justify-center ${TILE_TINTS[1]}`}>
                <LeafMark size={72} className="text-[#6B8F66]" />
              </div>
              <div className="flex flex-col gap-1.5 px-4 pb-4 pt-3.5">
                <p className="text-lead font-bold">{q.trim() ? `Nothing called “${q.trim()}”` : "Nothing here"}</p>
                <p className="text-meta text-ink-2">
                  {q.trim() ? "Try part of the common name, the Latin name, the genus or the family." : "Pick another place, or add a plant."}
                </p>
                <button type="button" onClick={() => setGridParams({ q: "", at: "all" })} className="btn btn-soft btn-compact mt-2 self-start">
                  Show every species
                </button>
              </div>
            </li>
            {[2, 3].map((i) => (
              <li key={i} aria-hidden className="opacity-60">
                <BlankTile tint={TILE_TINTS[i]} />
              </li>
            ))}
          </>
        ) : (
          shown.map((r, i) => (
            <li key={r.id}>
              <SpeciesTile row={r} line={tileLine(r, at)} tint={TILE_TINTS[i % TILE_TINTS.length]} />
            </li>
          ))
        )}
      </ul>

      <p className="text-center text-meta text-ink-2 tabular-nums">{showingSpecies(shown.length, total)}</p>
    </div>
  );
}

/**
 * One species: its photo (the owner's, else the reference, else a tinted
 * tile) 168 px tall, the common name with the italic binomial under it (or
 * the binomial as the name, with that line reserved so every tile is the
 * same height), and the meta line for the chip on screen. One link.
 */
function SpeciesTile({ row, line, tint }: { row: SpeciesListRow; line: string; tint: string }) {
  const common = displayName(row.commonName);
  return (
    <Link href={`/species/${row.id}`} className="card card-link flex h-full flex-col overflow-hidden text-ink hover:text-ink hover:no-underline">
      {row.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={row.thumbUrl} alt="" loading="lazy" width={320} height={168} className="h-[168px] w-full object-cover" />
      ) : (
        <div className={`flex h-[168px] items-center justify-center ${tint}`}>
          <LeafMark size={72} className="text-[#6B8F66]" />
        </div>
      )}
      <div className="flex flex-col gap-1 px-4 pb-4 pt-3.5">
        <p className={`text-lead leading-snug ${common ? "font-bold" : "font-display italic"}`}>{speciesTitle(row)}</p>
        {common ? (
          <p className="sp">{speciesLabel(row.scientificName, row.cultivar)}</p>
        ) : (
          <p aria-hidden className="invisible">
            &nbsp;
          </p>
        )}
        <p className="text-meta text-ink-2 tabular-nums">{line}</p>
      </div>
    </Link>
  );
}

/** A placeholder at a tile's exact height: the same lines, drawn invisible. */
export function BlankTile({ tint }: { tint: string }) {
  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <div className={`h-[168px] ${tint}`} />
      <div aria-hidden className="invisible flex flex-col gap-1 px-4 pb-4 pt-3.5">
        <p className="text-lead leading-snug">&nbsp;</p>
        <p>&nbsp;</p>
        <p className="text-meta">&nbsp;</p>
      </div>
    </div>
  );
}
