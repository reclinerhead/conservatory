import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// The Conservatory's database is created and migrated by Fern (fern/db.py);
// the web app opens it, read-only for pages and read-write for the routes
// that record a person's actions. Bracket access on purpose: Next inlines a
// static `process.env.FOO` at build time, and these must be read at runtime
// on the box. Resolved at call time against the working directory, with the
// tracer told to look away where the path is built and where it is checked:
// otherwise Turbopack's file tracing follows the relative default and pulls
// all of web/ into every route that opens the database.
function dbPath(): string {
  const configured = process.env["CONSERVATORY_DB"] ?? "../data/conservatory.db";
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), configured);
}

/** The directory photos live under (CONSERVATORY_DATA), absolute. */
export function dataDir(): string {
  const configured = process.env["CONSERVATORY_DATA"] ?? "../data";
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), configured);
}

/** Open the database read-only, or null when Fern has not created it yet. */
export function openReadOnly(): DatabaseSync | null {
  const file = dbPath();
  if (!existsSync(/* turbopackIgnore: true */ file)) return null;
  return new DatabaseSync(file, { readOnly: true });
}

/** Open the database for writing. Throws when Fern has not created it yet. */
export function openReadWrite(): DatabaseSync {
  const file = dbPath();
  if (!existsSync(/* turbopackIgnore: true */ file)) throw new Error(`database not found at ${file}; is Fern running?`);
  const db = new DatabaseSync(file);
  db.exec("PRAGMA busy_timeout = 5000"); // Fern writes to this file too
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

export type CollectionCounts = {
  specimens: number;
  species: number;
  places: number;
  waiting: number; // jobs identified or rejected and not yet confirmed
};

export const EMPTY_COUNTS: CollectionCounts = { specimens: 0, species: 0, places: 0, waiting: 0 };

/** Thumbnails of up to three photos waiting for a name, newest first, for the pending strip. */
export function waitingThumbs(limit = 3): string[] {
  const db = openReadOnly();
  if (!db) return [];
  try {
    const rows = db
      .prepare(
        `SELECT p.path FROM jobs j
           JOIN photos p ON p.job_id = j.id
          WHERE j.status IN ('identified', 'rejected')
            AND NOT EXISTS (SELECT 1 FROM confirmations c WHERE c.job_id = j.id)
          ORDER BY j.finished_at DESC, p.id
          LIMIT ?`,
      )
      .all(limit) as Array<{ path: string }>;
    return rows.map((r) => r.path);
  } finally {
    db.close();
  }
}

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
