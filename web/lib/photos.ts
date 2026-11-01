// Where a photo lives and how it is named. Pure; the routes are thin over this.

export const ORGANS = ["auto", "leaf", "flower", "fruit", "bark"] as const;
export type Organ = (typeof ORGANS)[number];

export function isOrgan(v: unknown): v is Organ {
  return typeof v === "string" && (ORGANS as readonly string[]).includes(v);
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heic",
};

/** File extension for an upload's MIME type; anything unknown is stored as jpg and Fern re-encodes. */
export function extForMime(mime: string | null | undefined): string {
  return EXT_BY_MIME[(mime ?? "").toLowerCase()] ?? "jpg";
}

/** photos/2026/10/<id>.jpg, relative to CONSERVATORY_DATA. Dated by upload, not by EXIF, so a folder is never surprising. */
export function relPathFor(id: string, ext: string, uploadedAt: Date): string {
  const y = uploadedAt.getUTCFullYear();
  const m = String(uploadedAt.getUTCMonth() + 1).padStart(2, "0");
  return `photos/${y}/${m}/${id}.${ext}`;
}

/** The thumbnail Fern writes beside a photo: <stem>.thumb.jpg. Mirrors fern/worker.py thumb_path. */
export function thumbPathFor(rel: string): string {
  const dot = rel.lastIndexOf(".");
  const stem = dot > rel.lastIndexOf("/") ? rel.slice(0, dot) : rel;
  return `${stem}.thumb.jpg`;
}

/**
 * The originals that can stand in for a photo's thumbnail Fern has not
 * written yet (a photo added to a plant waits for the idle sweep), in the
 * extensions the upload route writes. Empty for anything but a photo's
 * thumbnail; reference thumbnails are written with their image.
 */
export function originalsForThumb(rel: string): string[] {
  const m = /^(photos\/.+)\.thumb\.jpg$/.exec(rel);
  return m ? ["jpg", "png", "heic"].map((ext) => `${m[1]}.${ext}`) : [];
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SERVABLE = new Set(["jpg", "jpeg", "png", "heic"]);
const REFERENCE_FILE = /^[0-9]+(\.thumb)?\.jpg$/;

/**
 * The guard for GET /media/[...path]: exactly the shapes Fern and the upload
 * route write, nothing a filesystem could interpret. photos/yyyy/mm/<file>
 * for an owner's photo or its thumbnail, reference/<species id>.jpg or
 * .thumb.jpg for a species' reference image. Returns the relative path or null.
 */
export function mediaRelPath(parts: string[]): string | null {
  if (parts.length === 2 && parts[0] === "reference") return REFERENCE_FILE.test(parts[1]) ? parts.join("/") : null;
  if (parts.length !== 4 || parts[0] !== "photos") return null;
  if (!parts.every((p) => SEGMENT.test(p) && !p.includes(".."))) return null;
  const file = parts[3];
  const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
  if (!SERVABLE.has(ext)) return null;
  return parts.join("/");
}

/**
 * The URLs of a species' reference image and its thumbnail, or null when Fern
 * has none. `python -m fern --enrich` rewrites the same file, and the media
 * route caches for a year, so the enrichment stamp rides along as ?v= and a
 * re-fetched image is a new URL.
 */
export function referenceUrls(imagePath: string | null, version: string | null): { url: string; thumbUrl: string } | null {
  if (!imagePath) return null;
  const v = version ? `?v=${encodeURIComponent(version)}` : "";
  return { url: `/media/${imagePath}${v}`, thumbUrl: `/media/${thumbPathFor(imagePath)}${v}` };
}

export function contentTypeFor(rel: string): string {
  const ext = rel.slice(rel.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "heic") return "image/heic";
  return "image/jpeg";
}
