"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Term } from "@/components/term";
import { LeafMark } from "@/components/topbar";
import { displayName, showingLine, speciesLabel, TILE_TINTS } from "@/lib/collection";
import {
  familyChips,
  inFamily,
  matchesSpecies,
  selectedFamily,
  specimenCount,
  speciesTitle,
  type SpeciesListRow,
} from "@/lib/species-page";

/** Write the list's filters into the URL with the native history API, as the collection does, so back returns to the same view. */
function setListParams(next: { q?: string; family?: string }) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined) continue;
    if (v === "" || (k === "family" && v === "all")) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  window.history.replaceState(null, "", url.pathname + url.search);
}

// The species list: one row per species, most owned first. Every row is on
// the page already, so the top bar's search and the family chips filter
// here, on the phone, through the URL (?q= and ?family=), the same way the
// collection filters by location.
export function SpeciesList({ rows }: { rows: SpeciesListRow[] }) {
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const chips = familyChips(rows);
  const family = selectedFamily(chips, params.get("family"));
  const shown = rows.filter((r) => inFamily(r, family) && matchesSpecies(r, q));

  return (
    <div className="flex flex-col gap-4">
      {/* Filter row: chips wrap, never scroll sideways; counts are from the whole list. */}
      <div role="group" aria-label="Filter by family" className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-meta font-semibold text-ink-2">
          <Term k="family">Family</Term>
        </span>
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={family === c.key}
            onClick={() => setListParams({ family: c.key })}
            className={`chip chip-compact ${family === c.key ? "chip-on" : ""}`}
          >
            {c.label}
            <span className="font-normal opacity-80 tabular-nums">{c.n}</span>
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {/* Column heads from sm up; on a phone the family sits under the name. */}
        <div aria-hidden className="hidden items-center gap-4 border-b border-line bg-ground px-5 py-2.5 text-meta font-semibold text-ink-2 sm:flex">
          <span className="w-14 flex-none" />
          <span className="min-w-0 flex-1">Species</span>
          <span className="w-52 flex-none">
            <Term k="family">Family</Term>
          </span>
          <span className="w-28 flex-none text-right">In your collection</span>
        </div>

        {shown.length === 0 ? (
          <div className="flex min-h-[160px] flex-col items-start justify-center gap-1.5 px-5 py-6">
            <p className="text-lead font-bold">{family === "all" ? `Nothing called “${q.trim()}”` : `Nothing called “${q.trim()}” in ${family}`}</p>
            <p className="text-meta text-ink-2">Try part of the common name, the Latin name, the genus or the family.</p>
            <button type="button" onClick={() => setListParams({ q: "", family: "all" })} className="btn btn-soft btn-compact mt-2">
              Show every species
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((r, i) => {
              const common = displayName(r.commonName);
              return (
                <li key={r.id}>
                  <Link
                    href={`/species/${r.id}`}
                    className="flex min-h-[80px] items-center gap-4 px-4 py-3 text-ink transition-colors hover:bg-ground hover:text-ink hover:no-underline sm:px-5"
                  >
                    {r.thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.thumbUrl} alt="" loading="lazy" width={56} height={56} className="h-14 w-14 flex-none rounded-thumb object-cover" />
                    ) : (
                      <span aria-hidden className={`flex h-14 w-14 flex-none items-center justify-center rounded-thumb ${TILE_TINTS[i % TILE_TINTS.length]}`}>
                        <LeafMark size={28} className="text-[#6B8F66]" />
                      </span>
                    )}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={`text-lead font-bold leading-snug ${common ? "" : "font-display font-normal italic"}`}>{speciesTitle(r)}</span>
                      {common ? <span className="sp break-words">{speciesLabel(r.scientificName, r.cultivar)}</span> : null}
                      <span className="text-meta text-ink-2 sm:hidden">{r.family ?? "Family not known yet"}</span>
                    </span>
                    <span className="hidden w-52 flex-none text-body text-ink-2 sm:block">{r.family ?? <span className="text-ink-3">not known yet</span>}</span>
                    <span className="w-24 flex-none text-right text-meta text-ink-2 tabular-nums sm:w-28">{specimenCount(r.specimens)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="text-center text-meta text-ink-2 tabular-nums">{showingLine(shown.length, rows.length)}</p>
    </div>
  );
}
