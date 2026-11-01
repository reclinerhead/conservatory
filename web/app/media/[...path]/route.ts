// GET /media/photos/<yyyy>/<mm>/<file>: a photo or its thumbnail, and
// GET /media/reference/<species id>.jpg (or .thumb.jpg): a species' reference
// image, both from CONSERVATORY_DATA. The path guard (mediaRelPath) accepts
// exactly the shapes the upload route and Fern write and nothing a filesystem
// could interpret. Photo names are UUIDs written once; a reference image can
// be re-fetched in place, so its URL carries ?v=<enriched_at> (referenceUrls)
// and the browser may cache both for a year.
//
// A photo's thumbnail Fern has not written yet (a photo added to a plant waits
// for the idle sweep, a job's for its turn in the queue) is answered with the
// original, uncached, so the page shows the photo now and the real thumbnail
// from the next load.

import { promises as fs } from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/db";
import { contentTypeFor, mediaRelPath, originalsForThumb } from "@/lib/photos";

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await ctx.params;
  const rel = mediaRelPath(parts ?? []);
  if (!rel) return new Response(null, { status: 404 });
  const bytes = await read(rel);
  if (bytes) return image(bytes, rel, "public, max-age=31536000, immutable");
  for (const original of originalsForThumb(rel)) {
    const stand = await read(original);
    if (stand) return image(stand, original, "no-store");
  }
  return new Response(null, { status: 404 });
}

async function read(rel: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(path.join(dataDir(), rel));
  } catch {
    return null;
  }
}

function image(bytes: Buffer, rel: string, cacheControl: string): Response {
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": contentTypeFor(rel), "content-length": String(bytes.byteLength), "cache-control": cacheControl },
  });
}
