import Link from "next/link";
import { redirect } from "next/navigation";
import { waitingJobIds, withReadDb } from "@/lib/jobs";

// /name: the strip's link. Sends the person to the oldest plant waiting for a
// name, or says there is none.
export const dynamic = "force-dynamic";

export default function NameIndex() {
  const ids = withReadDb((db) => waitingJobIds(db), []);
  if (ids.length > 0) redirect(`/name/${ids[0]}`);
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 pb-14 pt-6 sm:px-8 sm:pt-8">
      <h1 className="text-h1 leading-[1.1]">Nothing waiting for a name</h1>
      <p className="max-w-prose text-lead text-ink-2">
        Every photo you have added has a name on it. Add another and Fern will have a guess ready in a few seconds.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link href="/add" className="btn btn-primary text-white hover:text-white hover:no-underline">
          Add a plant
        </Link>
        <Link href="/" className="btn btn-soft hover:no-underline">
          Back to the Conservatory
        </Link>
      </div>
    </main>
  );
}
