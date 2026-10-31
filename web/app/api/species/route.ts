// GET /api/species?q=: the species already in the collection, most-owned
// first, for the name field's autocomplete (the roster match from the
// README: the second pot of anything is easier to name than the first).

import { openReadOnly } from "@/lib/db";

export const dynamic = "force-dynamic";

export type SpeciesHit = { id: number; scientificName: string; cultivar: string | null; specimens: number };

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  const db = openReadOnly();
  if (!db) return Response.json([]);
  try {
    const rows = db
      .prepare(
        `SELECT s.id, s.scientific_name, s.cultivar, COUNT(sp.id) AS n
           FROM species s LEFT JOIN specimens sp ON sp.species_id = s.id AND sp.status = 'alive'
          WHERE ? = '' OR lower(s.scientific_name) LIKE lower(?) OR lower(COALESCE(s.cultivar, '')) LIKE lower(?)
          GROUP BY s.id
          ORDER BY n DESC, s.scientific_name
          LIMIT 8`,
      )
      .all(q, `%${q}%`, `%${q}%`) as Array<{ id: number; scientific_name: string; cultivar: string | null; n: number }>;
    const hits: SpeciesHit[] = rows.map((r) => ({ id: r.id, scientificName: r.scientific_name, cultivar: r.cultivar, specimens: r.n }));
    return Response.json(hits, { headers: { "cache-control": "no-store" } });
  } finally {
    db.close();
  }
}
