// GET /api/cover: this week's cover plant, for the Conservatory's tile on the
// station launcher (reclinerhead/aviary#696). Answers { src, caption, credit }:
// a same-origin path to the species' full-size photo, its common name (the
// scientific name when it has none), and a credit that is always null here
// (the field belongs to the shape the three apps share). A candidate is a
// species on the life list with a plant alive and a photo of the household's
// own: the chosen one (#77), else the newest. A plant still waiting for a
// name has no species, and a species known only by its reference image has
// no photo to show, so neither can be picked. No database yet, or nothing
// that qualifies, is a quiet three nulls with a 200, and the launcher keeps
// its default photo.

import { BASE_PATH } from "@/lib/base-path";
import { displayName } from "@/lib/collection";
import { pickCover } from "@/lib/cover";
import { openReadOnly } from "@/lib/db";
import { speciesList } from "@/lib/species";

export const dynamic = "force-dynamic";

// The household's photos live under photos/ in the data directory and the
// reference images Fern fetches under reference/, so the prefix tells a
// species list row's own photo from a borrowed one.
const OWN_PHOTO = `${BASE_PATH}/media/photos/`;

function cover(src: string | null = null, caption: string | null = null) {
  return Response.json({ src, caption, credit: null }, { headers: { "cache-control": "no-store" } });
}

export async function GET() {
  const db = openReadOnly();
  if (!db) return cover();
  try {
    const pick = pickCover(
      speciesList(db).filter((s) => s.specimens > 0 && s.imageUrl?.startsWith(OWN_PHOTO)),
      new Date(),
    );
    return pick ? cover(pick.imageUrl, displayName(pick.commonName) ?? pick.scientificName) : cover();
  } finally {
    db.close();
  }
}
