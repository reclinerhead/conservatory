import Link from "next/link";
import { TagPrinter } from "@/components/tag-printer";
import { withReadDb } from "@/lib/jobs";
import { tagBase, tagCode } from "@/lib/tag-code";
import { tagUrl } from "@/lib/tags";
import { tagRows } from "@/lib/specimens";

// /tags: print pot tags (#36). Every living plant, one row each, with its
// code drawn here on the server (no QR library reaches the browser); the
// client component narrows, checks and lays out the sheets. Reached from the
// species page (?species=), a plant's page (?plant=) and the life list
// (?at=, the place on screen).
export const dynamic = "force-dynamic";

export const metadata = { title: "Pot tags · The Conservatory" };

export default function TagsPage() {
  const rows = withReadDb(tagRows, []).map((r) => ({ ...r, code: tagCode(r.id) }));
  // Where the codes point, shown so a sheet printed at the desk is not mistaken for the house's.
  const host = tagUrl(tagBase(), 1) ? new URL(tagBase()!.trim()).host : null;

  return (
    <main className="mx-auto flex w-full max-w-page flex-1 flex-col gap-6 px-4 pb-14 pt-6 sm:gap-7 sm:px-8 sm:pt-8">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-[14px] text-ink-2">
        <Link href="/" className="font-semibold text-ink-2">
          Collection
        </Link>
        <span aria-hidden>›</span>
        <span aria-current="page" className="font-semibold text-ink">
          Pot tags
        </span>
      </nav>

      <div className="flex flex-col gap-2.5">
        <h1 className="text-h1 leading-[1.05] sm:text-page-title">Pot tags</h1>
        <p className="max-w-[62ch] text-lead text-ink-2">
          A QR label for each pot. Scan one with your phone&rsquo;s camera and it opens that plant&rsquo;s page; the number on it
          is the plant&rsquo;s own and is never given to another.
        </p>
        <div className="mt-1 flex flex-wrap gap-2">
          <span className="tag">{rows.length === 1 ? "1 living plant" : `${rows.length} living plants`}</span>
          <span className="tag">{host ? `Tags open ${host}` : "No tag address set"}</span>
        </div>
      </div>

      <TagPrinter rows={rows} hasBase={host !== null} />
    </main>
  );
}
