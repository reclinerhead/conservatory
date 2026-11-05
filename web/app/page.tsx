import Link from "next/link";
import { BlankTile, SortSelect, SpeciesGrid } from "@/components/species-grid";
import { Term } from "@/components/term";
import { LeafMark } from "@/components/topbar";
import { dayLabel, displayName, speciesLabel, TILE_TINTS } from "@/lib/collection";
import { barTwelfths, familyTally, generaShown, recentSpecies, spotlightPick } from "@/lib/dashboard";
import { collectionCounts, waitingThumbs } from "@/lib/db";
import { withReadDb } from "@/lib/jobs";
import { thumbPathFor } from "@/lib/photos";
import { count, ledgerEntries, waitingDetail, waitingLabel } from "@/lib/ledger";
import { readSpecies, speciesList } from "@/lib/species";
import { ALL, tileLine } from "@/lib/species-grid";
import { aboutState, latinRuns, speciesTitle } from "@/lib/species-page";

// The dashboard from design/DESIGN.md §5, Phase 1 subset: the pending strip,
// the life list as a grid of species tiles with its place filters, and the
// side column's "New species added recently", "at a glance", "What you grow
// most" and "Get to know" cards. The greeting, Today's care, the other
// filters, Blooming now and the Flower Show arrive with the phases that have
// data for them; their space is not faked.
// The counts come from the database on every request, never from the build.
export const dynamic = "force-dynamic";

const RECENT_ROWS = 4;
const FAMILY_ROWS = 5;
// A family's bar, by its width in twelfths (barTwelfths). Written out whole
// so Tailwind finds every class.
const BAR_WIDTHS = ["w-0", "w-1/12", "w-2/12", "w-3/12", "w-4/12", "w-5/12", "w-6/12", "w-7/12", "w-8/12", "w-9/12", "w-10/12", "w-11/12", "w-full"];

export default function Home() {
  const counts = collectionCounts();
  const ledger = ledgerEntries(counts);
  const waiting = counts.waiting;
  const thumbs = waitingThumbs(3);
  const rows = withReadDb(speciesList, []);
  const recent = recentSpecies(rows, RECENT_ROWS);
  const tally = familyTally(rows);
  const families = tally.families.length;
  const topFamily = tally.families[0]?.species ?? 0;
  // Get to know: today's species, read whole for its summary and care sheet.
  const pick = spotlightPick(rows, new Date());
  const spot = pick ? withReadDb((db) => readSpecies(db, pick.id), null) : null;
  const spotAbout = spot ? aboutState(spot) : null;
  const spotParagraph = spotAbout?.kind === "summary" ? spotAbout.paragraphs[0] : null;
  const spotCells = spot?.care.kind === "sheet" ? spot.care.cells : null;
  const spotCommon = pick ? displayName(pick.commonName) : null;

  return (
    <main className="mx-auto flex w-full max-w-page flex-1 flex-col gap-7 px-4 pb-14 pt-6 sm:px-8 sm:pt-8">
      {/* Pending identifications strip: a sage card, three overlapping thumbs,
          the headline, one primary button. Same height in every state. */}
      <section aria-label="Plants waiting for a name" className="card flex flex-wrap items-center gap-x-6 gap-y-4 border-line-2 bg-sage px-5 py-4">
        <div className="flex">
          {[0, 1, 2].map((i) => {
            const path = thumbs[i];
            const tint = ["bg-tile-2", "bg-[#BFD6B6]", "bg-[#A9C9A0]"][i];
            return path ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={`/media/${thumbPathFor(path)}`} alt="" className={`thumb border-2 border-sage ${i < 2 ? "-mr-2.5" : ""}`} />
            ) : (
              <div key={i} aria-hidden className={`thumb border-2 border-sage ${tint} ${i < 2 ? "-mr-2.5" : ""}`}>
                <LeafMark size={26} className={i === 2 ? "text-moss-deep" : "text-moss"} />
              </div>
            );
          })}
        </div>
        <div className="flex-[1_1_300px]">
          <p className={`text-lead font-bold ${waiting > 0 ? "text-ink" : "text-ink-2"}`}>{waitingLabel(waiting)}</p>
          <p className="mt-0.5 text-meta text-ink-2">{waitingDetail(waiting)}</p>
        </div>
        <Link
          href="/name"
          aria-hidden={waiting === 0}
          tabIndex={waiting === 0 ? -1 : 0}
          className={`btn btn-primary text-white hover:text-white hover:no-underline ${waiting === 0 ? "invisible" : ""}`}
        >
          Name them
        </Link>
      </section>

      <div className="flex flex-wrap items-start gap-7">
        {/* Life list */}
        <section aria-labelledby="list-h" className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div>
              <h2 id="list-h" className="text-h2 leading-tight">
                Life list
              </h2>
              <p className="mt-1 text-meta text-ink-2 tabular-nums">{ledger.join(" · ")}</p>
            </div>
            <SortSelect />
          </div>

          {rows.length === 0 ? (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <li className="card flex flex-col overflow-hidden">
                <div className={`flex h-[168px] items-center justify-center ${TILE_TINTS[0]}`}>
                  <LeafMark size={72} className="text-[#6B8F66]" />
                </div>
                <div className="flex flex-col gap-1.5 px-4 pb-4 pt-3.5">
                  <p className="text-lead font-bold">No species yet</p>
                  <p className="text-meta text-ink-2">The first plant you name becomes the first card here.</p>
                  <Link href="/add" className="btn btn-soft mt-2 self-start hover:no-underline">
                    Add the first one
                  </Link>
                </div>
              </li>
              {[1, 2].map((i) => (
                <li key={i} aria-hidden className="opacity-60">
                  <BlankTile tint={TILE_TINTS[i]} />
                </li>
              ))}
            </ul>
          ) : (
            <SpeciesGrid rows={rows} />
          )}
        </section>

        {/* Side column */}
        <aside className="flex w-full flex-[1_1_300px] flex-col gap-5 lg:max-w-sidebar">
          {/* New species added recently: always four rows tall. The species
              that joined last, each one link; blank rows hold the rest. */}
          <section className="card px-5 pb-3 pt-5" aria-labelledby="new-h">
            <h3 id="new-h" className="mb-2 text-h3">
              New species added recently
            </h3>
            <ul>
              {Array.from({ length: RECENT_ROWS }, (_, i) => {
                const r = recent[i];
                const tint = TILE_TINTS[i % TILE_TINTS.length];
                const rowClass = "border-t border-sage first:border-t-0";
                if (!r) {
                  return i === 0 ? (
                    <li key={i} className={rowClass}>
                      <div className="flex min-h-[68px] items-center gap-3 py-2.5">
                        <div aria-hidden className={`thumb ${tint}`}>
                          <LeafMark size={26} className="text-[#6B8F66]" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-bold">No species yet</p>
                          <p className="truncate text-meta text-ink-2">The first plant you name shows up here.</p>
                        </div>
                      </div>
                    </li>
                  ) : (
                    <li key={i} aria-hidden className={rowClass}>
                      <div className="flex min-h-[68px] items-center gap-3 py-2.5">
                        <div className={`thumb ${tint} opacity-60`} />
                        <div className="flex flex-1 flex-col gap-2">
                          <span className="block h-3 w-3/5 rounded-pill bg-sage" />
                          <span className="block h-2.5 w-2/5 rounded-pill bg-sage" />
                        </div>
                      </div>
                    </li>
                  );
                }
                const common = displayName(r.commonName);
                return (
                  <li key={r.id} className={rowClass}>
                    <Link href={`/species/${r.id}`} className="group flex min-h-[68px] items-center gap-3 py-2.5 text-ink hover:text-ink hover:no-underline">
                      {r.thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.thumbUrl} alt="" width={48} height={48} className="thumb" />
                      ) : (
                        <div aria-hidden className={`thumb ${tint}`}>
                          <LeafMark size={26} className="text-[#6B8F66]" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className={`truncate group-hover:underline ${common ? "font-bold" : "font-display italic"}`}>{speciesTitle(r)}</p>
                        <p className="truncate text-meta text-ink-2">
                          {common ? (
                            <>
                              <span className="sp">{speciesLabel(r.scientificName, r.cultivar)}</span>
                              {" · "}
                            </>
                          ) : null}
                          {dayLabel(r.addedAt)}
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="card p-5" aria-labelledby="glance-h">
            <h3 id="glance-h" className="mb-3 text-h3">
              Your collection at a glance
            </h3>
            <div className="grid grid-cols-2 gap-2.5">
              {(
                [
                  [counts.specimens, "specimens", "specimen"],
                  [counts.species, "species", "species"],
                  [families, "families", "family"],
                  [counts.places, "locations", null],
                ] as const
              ).map(([n, label, term]) => (
                <div key={label} className="rounded-tile bg-sage px-3.5 py-3">
                  <p className="font-display text-[28px] leading-none tabular-nums">{n}</p>
                  <p className="mt-1 text-meta text-ink-2">{term ? <Term k={term}>{label}</Term> : label}</p>
                </div>
              ))}
            </div>
          </section>

          {/* What you grow most: always five rows tall. Families by their
              living species, each opening the grid searched for it. */}
          <section className="card px-5 pb-4 pt-5" aria-labelledby="grow-h">
            <h3 id="grow-h" className="text-h3">
              What you grow most
            </h3>
            <p className="mt-1 text-meta text-ink-2">
              Species in each <Term k="family">family</Term>
            </p>
            <ul className="mt-2">
              {Array.from({ length: FAMILY_ROWS }, (_, i) => {
                const f = tally.families[i];
                const rowClass = "border-t border-sage first:border-t-0";
                if (!f) {
                  return i === 0 ? (
                    <li key={i} className={rowClass}>
                      <div className="flex h-20 flex-col justify-center gap-0.5">
                        <p className="truncate font-bold">No families yet</p>
                        <p className="text-meta text-ink-2">Families show here once Fern has placed your plants.</p>
                      </div>
                    </li>
                  ) : (
                    <li key={i} aria-hidden className={rowClass}>
                      <div className="flex h-20 flex-col justify-center gap-2">
                        <span className="block h-3 w-2/5 rounded-pill bg-sage" />
                        <span className="block h-1.5 w-full rounded-pill bg-sage" />
                        <span className="block h-2.5 w-3/5 rounded-pill bg-sage" />
                      </div>
                    </li>
                  );
                }
                const { names, more } = generaShown(f.genera);
                return (
                  <li key={f.name} className={rowClass}>
                    <Link
                      href={`/?q=${encodeURIComponent(f.name)}`}
                      className="group flex h-20 flex-col justify-center gap-1.5 text-ink hover:text-ink hover:no-underline"
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="truncate font-bold group-hover:underline">{f.name}</span>
                        <span className="flex-none text-meta text-ink-2 tabular-nums">{count(f.species, "species", "species")}</span>
                      </span>
                      <span aria-hidden className="block h-1.5 w-full rounded-pill bg-sage">
                        <span className={`block h-full rounded-pill bg-moss ${BAR_WIDTHS[barTwelfths(f.species, topFamily)]}`} />
                      </span>
                      <span className="truncate text-meta text-ink-2">
                        {names.length > 0 ? <span className="sp">{names.join(", ")}</span> : " "}
                        {more > 0 ? ` +${more} more` : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <p className="mt-1 truncate text-meta text-ink-2 tabular-nums">
              {count(families, "family", "families")} in all
              {tally.unplaced > 0 ? ` · ${count(tally.unplaced, "species", "species")} not placed yet` : null}
            </p>
          </section>

          {/* Get to know: one of the household's species a day. Every part
              keeps its height whichever species it is, or none. */}
          <section className="card p-5" aria-labelledby="know-h">
            <h3 id="know-h" className="mb-3 text-h3">
              Get to know
            </h3>
            {pick && spot && spotParagraph ? (
              <>
                <Link href={`/species/${pick.id}`} aria-hidden tabIndex={-1} className="block">
                  {pick.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={pick.thumbUrl} alt="" width={320} height={168} className="h-[168px] w-full rounded-tile object-cover" />
                  ) : (
                    <div className={`flex h-[168px] items-center justify-center rounded-tile ${TILE_TINTS[2]}`}>
                      <LeafMark size={72} className="text-[#6B8F66]" />
                    </div>
                  )}
                </Link>
                <div className="mt-3.5 flex flex-col gap-1">
                  <Link href={`/species/${pick.id}`} className={`truncate text-lead leading-snug text-ink hover:text-ink ${spotCommon ? "font-bold" : "font-display italic"}`}>
                    {speciesTitle(pick)}
                  </Link>
                  {spotCommon ? (
                    <p className="sp truncate">{speciesLabel(pick.scientificName, pick.cultivar)}</p>
                  ) : (
                    <p aria-hidden className="invisible">
                      &nbsp;
                    </p>
                  )}
                  <p className="truncate text-meta text-ink-2 tabular-nums">{tileLine(pick, ALL)}</p>
                </div>
                <p className="mt-3 line-clamp-4 h-[4lh] leading-normal">
                  {latinRuns(spotParagraph, [spot.scientificName, spot.canonicalName, spot.genus]).map((r, j) => (r.latin ? <em key={j}>{r.text}</em> : r.text))}
                </p>
                <div className="mt-3 flex flex-col gap-2">
                  {spotCells ? (
                    <>
                      <div className="h-6 whitespace-nowrap leading-6">
                        <Term k="light">
                          <span className="tag max-w-[calc(100%-1.75rem)] align-middle">
                            <span className="truncate">{spotCells.light.headline}</span>
                          </span>
                        </Term>
                      </div>
                      <div className="h-6 whitespace-nowrap leading-6">
                        <Term k="watering">
                          <span className="tag tag-water max-w-[calc(100%-1.75rem)] align-middle">
                            <span className="truncate">{spotCells.water.headline}</span>
                          </span>
                        </Term>
                      </div>
                    </>
                  ) : (
                    <>
                      <div aria-hidden className="flex h-6 items-center">
                        <span className="block h-[22px] w-40 rounded-pill bg-sage" />
                      </div>
                      <div aria-hidden className="flex h-6 items-center">
                        <span className="block h-[22px] w-32 rounded-pill bg-sage" />
                      </div>
                    </>
                  )}
                </div>
                <Link href={`/species/${pick.id}`} className="mt-3 block truncate font-semibold">
                  More about {speciesTitle(pick)}
                </Link>
              </>
            ) : (
              <>
                <div aria-hidden className={`flex h-[168px] items-center justify-center rounded-tile ${TILE_TINTS[2]}`}>
                  <LeafMark size={72} className="text-[#6B8F66]" />
                </div>
                {/* An invisible copy of the filled card's lines sets the
                    height; the message sits over it, under its title. */}
                <div className="mt-3.5 grid">
                  <div aria-hidden className="invisible col-start-1 row-start-1">
                    <div className="flex flex-col gap-1">
                      <p className="text-lead leading-snug">&nbsp;</p>
                      <p>&nbsp;</p>
                      <p className="text-meta">&nbsp;</p>
                    </div>
                    <p className="mt-3 h-[4lh] leading-normal">&nbsp;</p>
                    <div className="mt-3 flex flex-col gap-2">
                      <div className="h-6" />
                      <div className="h-6" />
                    </div>
                    <p className="mt-3 font-semibold">&nbsp;</p>
                  </div>
                  <div className="col-start-1 row-start-1 flex flex-col">
                    <p className="text-lead font-bold leading-snug">Nothing to show yet</p>
                    <p className="mt-1 leading-normal text-ink-2">Each day one of your plants takes a turn here, once Fern has fetched its Wikipedia summary.</p>
                    <div aria-hidden className="mt-auto flex flex-col gap-2 pb-[calc(1lh+0.75rem)]">
                      <div className="flex h-6 items-center">
                        <span className="block h-[22px] w-40 rounded-pill bg-sage" />
                      </div>
                      <div className="flex h-6 items-center">
                        <span className="block h-[22px] w-32 rounded-pill bg-sage" />
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>
        </aside>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-meta text-ink-2">
        <p>Identification by Pl@ntNet.</p>
        <p>Fern is minding the queue.</p>
      </footer>
    </main>
  );
}
