import { notFound } from "next/navigation";
import { Namer } from "@/components/namer";
import { lastConfirmedSpecimen, nextWaitingJob, readJob, waitingJobIds, withReadDb } from "@/lib/jobs";

// /name/[id]: one plant per screen.
export const dynamic = "force-dynamic";

export const metadata = { title: "Name this plant · The Conservatory" };

export default async function NamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId <= 0) notFound();
  const data = withReadDb(
    (db) => {
      const job = readJob(db, jobId);
      if (!job) return null;
      const ids = waitingJobIds(db);
      return {
        job,
        waiting: ids.length,
        position: Math.max(1, ids.indexOf(jobId) + 1),
        nextJobId: nextWaitingJob(ids, jobId),
        lastSpecimen: lastConfirmedSpecimen(db),
      };
    },
    null,
  );
  if (!data) notFound();
  return (
    <main className="mx-auto flex w-full max-w-page flex-1 flex-col gap-5 px-4 pb-14 pt-6 sm:px-8 sm:pt-8">
      <Namer
        initialJob={data.job}
        waiting={data.waiting}
        position={data.position}
        nextJobId={data.nextJobId}
        lastSpecimen={data.lastSpecimen}
      />
    </main>
  );
}
