// POST /api/jobs/:id/confirm: the person puts a name on the plant. One of:
//   { kind: "species" | "genus", rank }   a pill Fern offered
//   { typedName }                          a name they typed
//   { sameAsSpecimenId }                   another photo of a plant just named
// plus an optional `cultivar` (the name on the nursery tag) for the first two.
// Creates the species row if new, the specimen, links the job's photos, and
// writes the confirmations row, in one transaction. Saves at once: there is
// no batch save.
//
// DELETE /api/jobs/:id/confirm: "Change". Reverses it: removes the
// confirmation, unlinks the photos, deletes the specimen if nothing else is
// attached to it and the species if no specimen is left, and the job is back
// in the strip. Refused (409) once every photo of the job has been removed
// from the plant's page (#34): the strip would get a job with nothing to show.

import { openReadWrite } from "@/lib/db";
import { nextWaitingJob, waitingJobIds } from "@/lib/jobs";

export const dynamic = "force-dynamic";

type Body = {
  kind?: "species" | "genus";
  rank?: number;
  typedName?: string;
  cultivar?: string;
  sameAsSpecimenId?: number;
};

const NAME_MAX = 120;

function clean(s: unknown, max = NAME_MAX): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim().replace(/\s+/g, " ");
  return t.length === 0 ? null : t.slice(0, max);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId <= 0) return Response.json({ error: "bad id" }, { status: 400 });
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "expected json" }, { status: 400 });
  }
  const cultivar = clean(body.cultivar, 80);

  let db;
  try {
    db = openReadWrite();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
  try {
    const job = db.prepare("SELECT id, status FROM jobs WHERE id = ?").get(jobId) as { id: number; status: string } | undefined;
    if (!job) return Response.json({ error: "no such job" }, { status: 404 });
    if (job.status !== "identified" && job.status !== "rejected")
      return Response.json({ error: `job is ${job.status}` }, { status: 409 });
    if (db.prepare("SELECT 1 FROM confirmations WHERE job_id = ?").get(jobId))
      return Response.json({ error: "already named" }, { status: 409 });

    db.exec("BEGIN IMMEDIATE");
    let specimenId: number;
    let chosenRank: number | null = null;
    let typedName: string | null = null;
    let name: string;

    if (body.sameAsSpecimenId) {
      const sp = db
        .prepare(
          `SELECT sp.id, COALESCE(sp.nickname, s.scientific_name) AS name FROM specimens sp
             JOIN species s ON s.id = sp.species_id WHERE sp.id = ?`,
        )
        .get(Number(body.sameAsSpecimenId)) as { id: number; name: string } | undefined;
      if (!sp) {
        db.exec("ROLLBACK");
        return Response.json({ error: "no such specimen" }, { status: 404 });
      }
      specimenId = sp.id;
      name = sp.name;
    } else {
      let scientificName: string;
      let genus: string | null = null;
      let family: string | null = null;
      let gbifId: string | null = null;
      if (body.kind && body.rank) {
        const c = db
          .prepare("SELECT scientific_name, genus, family, gbif_id FROM candidates WHERE job_id = ? AND kind = ? AND rank = ?")
          .get(jobId, body.kind, Number(body.rank)) as
          | { scientific_name: string; genus: string | null; family: string | null; gbif_id: string | null }
          | undefined;
        if (!c) {
          db.exec("ROLLBACK");
          return Response.json({ error: "no such candidate" }, { status: 404 });
        }
        scientificName = c.scientific_name;
        genus = c.genus;
        family = c.family;
        gbifId = body.kind === "species" ? c.gbif_id : null;
        chosenRank = Number(body.rank);
      } else {
        const typed = clean(body.typedName);
        if (!typed) {
          db.exec("ROLLBACK");
          return Response.json({ error: "no name" }, { status: 400 });
        }
        scientificName = typed;
        typedName = typed;
        // A typed name that matches one of Fern's candidates keeps the
        // candidate's taxonomy, so "Ficus elastica" typed by hand is as
        // complete a species row as the pill would have made.
        const match = db
          .prepare("SELECT scientific_name, genus, family, gbif_id FROM candidates WHERE job_id = ? AND lower(scientific_name) = lower(?) ORDER BY kind = 'species' DESC, rank LIMIT 1")
          .get(jobId, typed) as { scientific_name: string; genus: string | null; family: string | null; gbif_id: string | null } | undefined;
        if (match) {
          scientificName = match.scientific_name;
          genus = match.genus;
          family = match.family;
          gbifId = match.gbif_id;
        }
      }

      // Find or create the species. UNIQUE(scientific_name, cultivar) does
      // not catch two NULL cultivars, so look it up by hand, case-insensitively.
      const existing = db
        .prepare("SELECT id FROM species WHERE lower(scientific_name) = lower(?) AND cultivar IS ? LIMIT 1")
        .get(scientificName, cultivar) as { id: number } | undefined;
      let speciesId: number;
      if (existing) {
        speciesId = existing.id;
      } else {
        const ins = db
          .prepare("INSERT INTO species (scientific_name, genus, family, gbif_id, cultivar) VALUES (?, ?, ?, ?, ?)")
          .run(scientificName, genus, family, gbifId, cultivar);
        speciesId = Number(ins.lastInsertRowid);
      }
      const sp = db.prepare("INSERT INTO specimens (species_id) VALUES (?)").run(speciesId);
      specimenId = Number(sp.lastInsertRowid);
      name = cultivar ? `${scientificName} '${cultivar}'` : scientificName;
    }

    db.prepare("UPDATE photos SET specimen_id = ? WHERE job_id = ?").run(specimenId, jobId);
    db.prepare("INSERT INTO confirmations (job_id, specimen_id, chosen_rank, typed_name) VALUES (?, ?, ?, ?)").run(
      jobId,
      specimenId,
      chosenRank,
      typedName,
    );
    db.exec("COMMIT");

    const nextJobId = nextWaitingJob(waitingJobIds(db), jobId);
    return Response.json({ specimenId, name, nextJobId }, { status: 201 });
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* nothing to roll back */
    }
    return Response.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    db.close();
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId <= 0) return Response.json({ error: "bad id" }, { status: 400 });
  let db;
  try {
    db = openReadWrite();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
  try {
    const conf = db.prepare("SELECT specimen_id FROM confirmations WHERE job_id = ?").get(jobId) as { specimen_id: number } | undefined;
    if (!conf) return Response.json({ error: "not named" }, { status: 404 });
    const photos = (db.prepare("SELECT COUNT(*) AS n FROM photos WHERE job_id = ?").get(jobId) as { n: number }).n;
    if (photos === 0) return Response.json({ error: "its photos were removed from the plant's page" }, { status: 409 });
    db.exec("BEGIN IMMEDIATE");
    db.prepare("DELETE FROM confirmations WHERE job_id = ?").run(jobId);
    db.prepare("UPDATE photos SET specimen_id = NULL WHERE job_id = ?").run(jobId);
    const left = (db.prepare("SELECT COUNT(*) AS n FROM photos WHERE specimen_id = ?").get(conf.specimen_id) as { n: number }).n;
    let removedSpecimen = false;
    if (left === 0) {
      const sp = db.prepare("SELECT species_id FROM specimens WHERE id = ?").get(conf.specimen_id) as { species_id: number } | undefined;
      db.prepare("DELETE FROM specimens WHERE id = ?").run(conf.specimen_id);
      removedSpecimen = true;
      if (sp) {
        const others = (db.prepare("SELECT COUNT(*) AS n FROM specimens WHERE species_id = ?").get(sp.species_id) as { n: number }).n;
        if (others === 0) db.prepare("DELETE FROM species WHERE id = ?").run(sp.species_id);
      }
    }
    db.exec("COMMIT");
    return Response.json({ ok: true, removedSpecimen });
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* nothing to roll back */
    }
    return Response.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    db.close();
  }
}
