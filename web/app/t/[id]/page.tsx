import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LeafMark } from "@/components/topbar";
import { withReadDb } from "@/lib/jobs";

// /t/[id]: where a printed pot tag points (#36). A plant still in the
// collection, living or gone, is sent to its page with a 307: temporary on
// purpose, because a phone caches a 308 and the point of /t/ is that what a
// scan opens can change without reprinting a label. This segment has no
// loading.tsx, so the redirect stays an HTTP 307 rather than the client-side
// meta tag Next emits when it is streaming. A removed plant's tag lands on a
// small page that says so. Specimen ids are never reused (schema v5), so a
// tag can never open the wrong plant.
export const dynamic = "force-dynamic";

export const metadata = { title: "Pot tag · The Conservatory" };

export default async function TagPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d{0,15}$/.test(id)) notFound();
  const plantId = Number(id);
  const here = withReadDb((db) => db.prepare("SELECT 1 FROM specimens WHERE id = ?").get(plantId) !== undefined, false);
  if (here) redirect(`/plants/${plantId}`);

  return (
    <main className="mx-auto flex w-full max-w-page flex-1 flex-col items-center px-4 pb-14 pt-10 sm:px-8 sm:pt-16">
      <section aria-labelledby="gone-h" className="card flex w-full max-w-[520px] flex-col items-start gap-3 p-6 sm:px-8 sm:py-7">
        <div className="flex h-14 w-14 items-center justify-center rounded-tile bg-sage">
          <LeafMark size={30} className="text-moss" />
        </div>
        <h1 id="gone-h" className="text-section leading-tight">
          This tag&rsquo;s plant is no longer in the collection
        </h1>
        <p className="text-body text-ink-2">
          Tag #{plantId} was printed for a plant that has since been removed. Its number is never given to another plant, so
          this tag will never open the wrong one.
        </p>
        <Link href="/" className="btn btn-soft btn-compact mt-1 hover:no-underline">
          Open the collection
        </Link>
      </section>
    </main>
  );
}
