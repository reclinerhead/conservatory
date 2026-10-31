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

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SERVABLE = new Set(["jpg", "jpeg", "png", "heic"]);

/**
 * The guard for GET /media/[...path]: exactly the shape relPathFor writes,
 * nothing a filesystem could interpret. Returns the relative path or null.
 */
export function mediaRelPath(parts: string[]): string | null {
  if (parts.length !== 4 || parts[0] !== "photos") return null;
  if (!parts.every((p) => SEGMENT.test(p) && !p.includes(".."))) return null;
  const file = parts[3];
  const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
  if (!SERVABLE.has(ext)) return null;
  return parts.join("/");
}

export function contentTypeFor(rel: string): string {
  const ext = rel.slice(rel.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "heic") return "image/heic";
  return "image/jpeg";
}
