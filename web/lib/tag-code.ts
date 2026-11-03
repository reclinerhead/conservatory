// A plant's pot-tag code, drawn on the server. Server only: the QR library
// stays out of the client bundle, and the print page receives each code as
// its SVG path (lib/tags.ts).

import { create } from "qrcode";
import { codePath, tagUrl } from "./tags";

export type TagCode = { url: string; size: number; path: string };

/**
 * The tag's address, read from CONSERVATORY_URL at runtime (bracket access,
 * so Next does not inline it at build), and never from the request: a sheet
 * printed from the dev server must not put a dev address on labels that last
 * years. Null when it is unset.
 */
export function tagBase(): string | null {
  return process.env["CONSERVATORY_URL"] ?? null;
}

/** The code for plant `id`, at error-correction level Q (25% recoverable, for soil and water); null without a base. */
export function tagCode(id: number): TagCode | null {
  const url = tagUrl(tagBase(), id);
  if (!url) return null;
  const { modules } = create(url, { errorCorrectionLevel: "Q" });
  return { url, size: modules.size, path: codePath(modules) };
}
