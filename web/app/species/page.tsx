import Link from "next/link";
import { SpeciesList } from "@/components/species-list";
import { LeafMark } from "@/components/topbar";
import { withReadDb } from "@/lib/jobs";
import { speciesLedger } from "@/lib/species-page";
import { speciesList } from "@/lib/species";

// /species: every species the household owns, one row each, most owned
// first. The Species pill in the top bar opens it, and the top bar's search
// filters it (?q=). Each row opens the species page.
export const dynamic = "force-dynamic";

export const metadata = { title: "Species · The Conservatory" };

export default function SpeciesIndex() {
  const rows = withReadDb(speciesList, []);

  return (
    <main className="mx-auto flex w-full max-w-page flex-1 flex-col gap-6 px-4 pb-14 pt-6 sm:px-8 sm:pt-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-h2 leading-tight">Species</h1>
        <p className="text-meta text-ink-2 tabular-nums">{speciesLedger(rows)}</p>
        <p className="mt-1 max-w-[62ch] text-body text-ink-2">
          Every kind of plant you have, with what Fern found out about it: where it sits in the plant world, what Wikipedia says, and every pot of it in
          your collection.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="card flex min-h-[240px] flex-col items-start justify-center gap-1.5 px-5 py-6">
          <span aria-hidden className="thumb mb-2 bg-tile-2">
            <LeafMark size={26} className="text-moss" />
          </span>
          <p className="text-lead font-bold">No species yet</p>
          <p className="text-meta text-ink-2">Name your first plant and its species appears here.</p>
          <Link href="/add" className="btn btn-soft mt-2 hover:no-underline">
            Add a plant
          </Link>
        </div>
      ) : (
        <SpeciesList rows={rows} />
      )}
    </main>
  );
}
