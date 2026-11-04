// When Fern is done with a job (#61). Pure, with no server imports, so the
// add page and the confirm screen (client components), the confirm route and
// the waiting queries share one rule.
//
// Fern marks a failed attempt `failed` with a `next_attempt_at` while it will
// still retry (network errors and 5xx, five attempts), and `failed` with no
// next attempt once it has given up (out of tries, or a 4xx). A job is
// settled, and waiting for a name, when it is identified, rejected, or failed
// for good.

export type JobStatus = "queued" | "identifying" | "identified" | "rejected" | "failed";

/** Named something, named nothing, or failed for good. A failed job with a next attempt is one Fern will retry. */
export function isSettled(job: { status: JobStatus | string; nextAttemptAt: string | null }): boolean {
  return job.status === "identified" || job.status === "rejected" || (job.status === "failed" && job.nextAttemptAt === null);
}

/** The same rule in SQL, over a jobs table aliased `j`. */
export const SETTLED_JOB_SQL = "(j.status IN ('identified', 'rejected') OR (j.status = 'failed' AND j.next_attempt_at IS NULL))";
