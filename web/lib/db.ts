import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// The Conservatory's database is created and migrated by Fern (fern/db.py);
// the web app only opens it. Bracket access on purpose: Next inlines a static
// `process.env.FOO` at build time, and these must be read at runtime on the box.
// Resolved at call time against the working directory, with the tracer told to
// look away: otherwise Turbopack's file tracing follows the relative default
// out of web/ and pulls the whole repo into the build.
function dbPath(): string {
  const configured = process.env["CONSERVATORY_DB"] ?? "../data/conservatory.db";
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), configured);
}

/** Open the database read-only, or null when Fern has not created it yet. */
export function openReadOnly(): DatabaseSync | null {
  const file = dbPath();
  if (!existsSync(file)) return null;
  return new DatabaseSync(file, { readOnly: true });
}

export type CollectionCounts = {
  specimens: number;
  species: number;
  places: number;
  waiting: number; // jobs identified or rejected and not yet confirmed
};

export const EMPTY_COUNTS: CollectionCounts = { specimens: 0, species: 0, places: 0, waiting: 0 };

export function collectionCounts(): CollectionCounts {
  const db = openReadOnly();
  if (!db) return EMPTY_COUNTS;
  try {
    const row = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM specimens WHERE status = 'alive') AS specimens,
           (SELECT COUNT(DISTINCT species_id) FROM specimens WHERE status = 'alive') AS species,
           (SELECT COUNT(DISTINCT location) FROM specimens WHERE status = 'alive' AND location IS NOT NULL) AS places,
           (SELECT COUNT(*) FROM jobs j
              WHERE j.status IN ('identified', 'rejected')
                AND NOT EXISTS (SELECT 1 FROM confirmations c WHERE c.job_id = j.id)) AS waiting`,
      )
      .get() as Record<keyof CollectionCounts, number>;
    return { ...row };
  } finally {
    db.close();
  }
}
