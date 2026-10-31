import Link from "next/link";
import { LeafMark } from "@/components/topbar";
import { collectionCounts, waitingThumbs } from "@/lib/db";
import { thumbPathFor } from "@/lib/photos";
import { ledgerEntries, waitingDetail, waitingLabel } from "@/lib/ledger";

// The dashboard from design/DESIGN.md §5, Phase 1 subset: the pending strip,
// the life list, and the side column's "at a glance" card. The greeting,
// Today's care, filters, Blooming now and the Flower Show arrive with the
// phases that have data for them; their space is not faked.
// The counts come from the database on every request, never from the build.
export const dynamic = "force-dynamic";

const TILE_TINTS = ["bg-tile-1", "bg-tile-2", "bg-tile-3", "bg-tile-4", "bg-tile-5"];

export default function Home() {
  const counts = collectionCounts();
  const ledger = ledgerEntries(counts);
  const waiting = counts.waiting;
  const thumbs = waitingThumbs(3);

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
          </div>

          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {counts.specimens === 0 ? (
              <>
                <li className="card card-link flex flex-col overflow-hidden">
                  <div className={`flex h-[168px] items-center justify-center ${TILE_TINTS[0]}`}>
                    <LeafMark size={72} className="text-[#6B8F66]" />
                  </div>
                  <div className="flex flex-col gap-1.5 px-4 pb-4 pt-3.5">
                    <p className="text-lead font-bold">No plants yet</p>
                    <p className="text-meta text-ink-2">The first photo you add becomes the first card here.</p>
                    <Link href="/add" className="btn btn-soft mt-2 self-start hover:no-underline">
                      Add the first one
                    </Link>
                  </div>
                </li>
                {[1, 2].map((i) => (
                  <li key={i} aria-hidden className="card flex flex-col overflow-hidden opacity-60">
                    <div className={`h-[168px] ${TILE_TINTS[i]}`} />
                    <div className="h-[104px]" />
                  </li>
                ))}
              </>
            ) : null}
          </ul>
        </section>

        {/* Side column */}
        <aside className="flex w-full flex-[1_1_300px] flex-col gap-5 lg:max-w-sidebar">
          <section className="card p-5" aria-labelledby="glance-h">
            <h3 id="glance-h" className="mb-3 text-h3">
              Your collection at a glance
            </h3>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                [counts.specimens, "specimens"],
                [counts.species, "species"],
                [counts.places, "locations"],
                [counts.waiting, "waiting for a name"],
              ].map(([n, label]) => (
                <div key={label} className="rounded-tile bg-sage px-3.5 py-3">
                  <p className="font-display text-[28px] leading-none tabular-nums">{n}</p>
                  <p className="mt-1 text-meta text-ink-2">{label}</p>
                </div>
              ))}
            </div>
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
