import Link from "next/link";
import { collectionCounts } from "@/lib/db";
import { ledgerEntries, waitingLabel } from "@/lib/ledger";

// The counts come from the database on every request, never from the build.
export const dynamic = "force-dynamic";

const GHOST_TILES = 5;

export default function Home() {
  const counts = collectionCounts();
  const ledger = ledgerEntries(counts);
  const waiting = counts.waiting;

  return (
    <>
      <header className="mullions border-b border-line">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 pt-10 pb-8 sm:pt-14 sm:pb-10">
          <div className="reveal flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="font-body text-xs font-medium uppercase tracking-[0.22em] text-ink-faint">
                A household&rsquo;s plants
              </p>
              <h1 className="font-display text-[2.75rem] leading-[0.95] sm:text-6xl lg:text-7xl text-ink mt-2">
                The Conservatory
              </h1>
              <ol className="mt-4 flex gap-x-4 font-body text-base text-ink-dim tabular-nums">
                {ledger.map((entry, i) => (
                  <li key={entry} className="flex items-center gap-x-4">
                    {i > 0 && <span aria-hidden className="h-1 w-1 rounded-full bg-line-strong" />}
                    <span>{entry}</span>
                  </li>
                ))}
              </ol>
            </div>
            <Link
              href="/add"
              className="inline-flex h-12 shrink-0 items-center justify-center rounded px-6 font-body text-base font-medium text-white bg-terracotta hover:bg-terracotta-deep active:bg-terracotta-deep transition-colors"
            >
              Add a plant
            </Link>
          </div>
        </div>
      </header>

      {/* The strip. Same height in every state; the link is laid out even when
          hidden so the label never shifts when the first job arrives. */}
      <section
        aria-label="Plants waiting for a name"
        className="reveal border-b border-line bg-pane-2"
        style={{ "--reveal-i": 1 } as React.CSSProperties}
      >
        <div className="mx-auto flex min-h-14 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <p className={`font-body text-base ${waiting > 0 ? "text-ink font-medium" : "text-ink-faint"}`}>
            {waitingLabel(waiting)}
          </p>
          <Link
            href="/name"
            aria-hidden={waiting === 0}
            tabIndex={waiting === 0 ? -1 : 0}
            className={`font-body text-base font-medium text-moss hover:text-moss-deep underline-offset-4 hover:underline ${
              waiting === 0 ? "invisible" : ""
            }`}
          >
            Name them &rarr;
          </Link>
        </div>
      </section>

      <main className="reveal mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6 lg:px-8 py-8" style={{ "--reveal-i": 2 } as React.CSSProperties}>
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-2xl sm:text-3xl text-ink">The collection</h2>
          <p className="font-body text-sm text-ink-faint tabular-nums">{ledger[0]}</p>
        </div>

        <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {counts.specimens === 0 ? (
            <>
              <li className="tile flex flex-col items-center justify-center border border-dashed border-line-strong bg-pane p-4 text-center">
                <p className="font-display text-xl text-ink">No plants yet.</p>
                <Link
                  href="/add"
                  className="mt-3 font-body text-base font-medium text-terracotta hover:text-terracotta-deep underline-offset-4 hover:underline"
                >
                  Add the first one
                </Link>
              </li>
              {Array.from({ length: GHOST_TILES }, (_, i) => (
                <li key={i} aria-hidden className="tile border border-line bg-pane/60" />
              ))}
            </>
          ) : null}
        </ul>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-4 sm:px-6 lg:px-8 font-body text-sm text-ink-faint">
          <p>Identification by Pl@ntNet.</p>
          <p>Fern is minding the queue.</p>
        </div>
      </footer>
    </>
  );
}
