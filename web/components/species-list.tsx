"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Term } from "@/components/term";
import { LeafMark } from "@/components/topbar";
import { showingLine, speciesLabel, TILE_TINTS } from "@/lib/collection";
import { displayName, matchesSpecies, specimenCount, speciesTitle, type SpeciesListRow } from "@/lib/species-page";

// The species list: one row per species, most owned first. Every row is on
// the page already, so the top bar's search filters here, on the phone,
// through the URL (?q=), the same way it filters the collection.
export function SpeciesList({ rows }: { rows: SpeciesListRow[] }) {
  const q = useSearchParams().get("q") ?? "";
  const shown = rows.filter((r) => matchesSpecies(r, q));

  return (
    <div className="flex flex-col gap-4">
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
            <p className="text-lead font-bold">{`Nothing called “${q.trim()}”`}</p>
            <p className="text-meta text-ink-2">Try part of the common name, the Latin name, the genus or the family.</p>
            <button
              type="button"
              onClick={() => {
                const url = new URL(window.location.href);
                url.searchParams.delete("q");
                window.history.replaceState(null, "", url.pathname + url.search);
              }}
              className="btn btn-soft btn-compact mt-2"
            >
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
