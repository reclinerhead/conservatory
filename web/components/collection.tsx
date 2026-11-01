"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LeafMark } from "@/components/topbar";
import { cardNames, groupTiles, locationChips, metaLine, showingLine, STATUS_LABEL, TILE_TINTS, type Tile } from "@/lib/collection";

// The life list from design/DESIGN.md §5: the filter row of location chips,
// then the specimen cards grouped by location. Every tile is on the page
// already (150 plants is a few kilobytes), so the search in the top bar and
// the chips filter here, on the phone, with no request. Both live in the URL
// (?q= and ?at=), written with the native history API so the back button
// returns to the same view and the top bar's box and this grid agree.
function setCollectionParams(next: { q?: string; at?: string }) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined) continue;
    if (v === "" || (k === "at" && v === "all")) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  window.history.replaceState(null, "", url.pathname + url.search);
}

export function Collection({ tiles }: { tiles: Tile[] }) {
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const where = params.get("at") ?? "all";
  const chips = locationChips(tiles);
  const known = chips.some((c) => c.key === where) ? where : "all";
  const groups = groupTiles(tiles, { q, where: known });
  const shown = groups.reduce((n, g) => n + g.tiles.length, 0);

  return (
    <div className="flex flex-col gap-4">
      {/* Filter row: chips wrap, never scroll sideways. */}
      <div role="group" aria-label="Filter by location" className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={known === c.key}
            onClick={() => setCollectionParams({ at: c.key })}
            className={`chip chip-compact ${known === c.key ? "chip-on" : ""}`}
          >
            {c.label}
            <span className="font-normal opacity-80 tabular-nums">{c.n}</span>
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <li className="card flex flex-col overflow-hidden">
            <div className={`flex h-[168px] items-center justify-center ${TILE_TINTS[1]}`}>
              <LeafMark size={72} className="text-[#6B8F66]" />
            </div>
            <div className="flex flex-col gap-1.5 px-4 pb-4 pt-3.5">
              <p className="text-lead font-bold">{q ? `Nothing called “${q.trim()}”` : "Nothing here"}</p>
              <p className="text-meta text-ink-2">{q ? "Try part of the nickname, the common name or the Latin name." : "Pick another location, or add a plant."}</p>
              <button type="button" onClick={() => setCollectionParams({ q: "", at: "all" })} className="btn btn-soft btn-compact mt-2 self-start">
                Show everything
              </button>
            </div>
          </li>
          {[2, 3].map((i) => (
            <li key={i} aria-hidden className="card flex flex-col overflow-hidden opacity-60">
              <div className={`h-[168px] ${TILE_TINTS[i]}`} />
              <div className="h-[128px]" />
            </li>
          ))}
        </ul>
      ) : (
        groups.map((g) => (
          <section key={g.key} aria-labelledby={`group-${g.key}`} className="flex flex-col gap-3">
            <h3 id={`group-${g.key}`} className="flex items-baseline gap-2 text-h3">
              {g.label}
              <span className="font-sans text-meta font-normal text-ink-2 tabular-nums">{g.tiles.length}</span>
            </h3>
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {g.tiles.map((t, i) => (
                <li key={t.id}>
                  <SpecimenCard tile={t} tint={TILE_TINTS[i % TILE_TINTS.length]} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <p className="text-center text-meta text-ink-2 tabular-nums">{showingLine(shown, tiles.length)}</p>
    </div>
  );
}

/**
 * The specimen card from DESIGN.md §4: photo or tinted tile 168 px tall,
 * the name, the common name under a nickname, the italic species, meta line,
 * tags. One link. `compact` is the species page's variant: 140 px and a
 * 16 px radius, as the mockup's `rel`, and no common name, since every card
 * there is the page's own species and its common name is the page's title.
 */
export function SpecimenCard({ tile, tint, compact = false }: { tile: Tile; tint: string; compact?: boolean }) {
  const { name, common, species } = cardNames(compact ? { ...tile, commonName: null } : tile);
  // Lines under the name are reserved, so a card keeps its height when Fern finds a common name.
  const blanks = (compact ? 1 : 2) - (common ? 1 : 0) - (species ? 1 : 0);
  const h = compact ? "h-[140px]" : "h-[168px]";
  return (
    <Link
      href={`/plants/${tile.id}`}
      className={`card card-link flex h-full flex-col overflow-hidden text-ink hover:text-ink hover:no-underline ${compact ? "rounded-[16px]" : ""}`}
    >
      {tile.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={tile.thumbUrl} alt="" loading="lazy" width={320} height={320} className={`${h} w-full object-cover`} />
      ) : (
        <div className={`flex ${h} items-center justify-center ${tint}`}>
          <LeafMark size={compact ? 60 : 72} className="text-[#6B8F66]" />
        </div>
      )}
      <div className="flex flex-col gap-1 px-4 pb-4 pt-3.5">
        <p className="text-lead font-bold leading-snug">{name}</p>
        {common ? <p className="text-ink-2">{common}</p> : null}
        {species ? <p className="sp">{species}</p> : null}
        {Array.from({ length: blanks }, (_, i) => (
          <p key={i} aria-hidden className="invisible">
            &nbsp;
          </p>
        ))}
        <p className="text-meta text-ink-2">{metaLine(tile)}</p>
        {tile.status !== "alive" ? (
          <div className="mt-1 flex flex-wrap gap-1.5">
            <span className="tag">{STATUS_LABEL[tile.status]}</span>
          </div>
        ) : null}
      </div>
    </Link>
  );
}
