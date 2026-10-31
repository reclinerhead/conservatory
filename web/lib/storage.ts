// Writing an uploaded photo to the data directory. Server only; used by
// POST /api/photos (a new job) and POST /api/jobs/[id]/photos (another photo
// of the same plant).

import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./db";
import { extForMime, relPathFor, thumbPathFor } from "./photos";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export type UploadCheck = { ok: true; file: Blob } | { ok: false; status: number; error: string };

export function checkUpload(form: FormData): UploadCheck {
  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) return { ok: false, status: 400, error: "no file" };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, status: 413, error: "file too large" };
  if (!file.type.startsWith("image/") && file.type !== "application/octet-stream")
    return { ok: false, status: 415, error: "not an image" };
  return { ok: true, file };
}

/** Write the file under photos/yyyy/mm/<uuid>.<ext>; returns the relative path. */
export async function storeUpload(file: Blob, now = new Date()): Promise<string> {
  const rel = relPathFor(crypto.randomUUID(), extForMime(file.type), now);
  const abs = path.join(dataDir(), rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, new Uint8Array(await file.arrayBuffer()));
  return rel;
}

/** Remove a photo and its thumbnail from disk; missing files are fine. */
export async function removeStored(rel: string): Promise<void> {
  for (const p of [rel, thumbPathFor(rel)]) {
    try {
      await unlink(path.join(dataDir(), p));
    } catch {
      /* already gone */
    }
  }
}

export function takenAtFrom(form: FormData): string | null {
  const raw = form.get("takenAt");
  return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(raw) ? raw : null;
}
