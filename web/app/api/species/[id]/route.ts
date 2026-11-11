// PATCH /api/species/:id: heroPhotoId, the photo the species is known by
// (#77), chosen in the species page's lightbox: a photo on one of the
// species' plants, or null for the default (the newest of its plants' main
// photos). It is the species page's hero and the species' thumbnail in the
// life list and in Relatives. Unknown keys are ignored.

import { openReadWrite } from "@/lib/db";
import { hasSpeciesHero } from "@/lib/specimens";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "bad id" }, { status: 400 });
  let body: { heroPhotoId?: unknown };
  try {
    body = (await req.json()) as { heroPhotoId?: unknown };
  } catch {
    return Response.json({ error: "expected json" }, { status: 400 });
  }
  const hero = body.heroPhotoId;
  if (hero === undefined) return Response.json({ error: "nothing to change" }, { status: 400 });
  if (hero !== null && !(Number.isInteger(hero) && (hero as number) > 0))
    return Response.json({ error: "heroPhotoId must be a photo id or null" }, { status: 400 });

  let db;
  try {
    db = openReadWrite();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
  try {
    if (!hasSpeciesHero(db)) return Response.json({ error: "Fern has not brought the database to schema v9 yet" }, { status: 503 });
    if (!db.prepare("SELECT 1 FROM species WHERE id = ?").get(id)) return Response.json({ error: "no such species" }, { status: 404 });
    if (
      typeof hero === "number" &&
      !db.prepare("SELECT 1 FROM photos p JOIN specimens sp ON sp.id = p.specimen_id WHERE p.id = ? AND sp.species_id = ?").get(hero, id)
    )
      return Response.json({ error: "not a photo of a plant of this species" }, { status: 400 });
    db.prepare("UPDATE species SET hero_photo_id = ? WHERE id = ?").run(hero as number | null, id);
    return Response.json({ heroPhotoId: hero });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    db.close();
  }
}
