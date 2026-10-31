import { describe, expect, it } from "vitest";
import { exifDateToIso, exifTakenAt } from "./exif";

/** Build a JPEG with one APP1 EXIF segment: IFD0 holding DateTime and a pointer to an Exif IFD holding DateTimeOriginal. */
function jpegWithExif(opts: { little?: boolean; original?: string; datetime?: string }): ArrayBuffer {
  const little = opts.little ?? true;
  const strings: string[] = [];
  const ifd0: Array<[number, number, number, number | string]> = []; // tag, type, count, value|string
  const exif: Array<[number, number, number, number | string]> = [];
  if (opts.datetime) ifd0.push([0x0132, 2, opts.datetime.length + 1, opts.datetime]);
  if (opts.original) exif.push([0x9003, 2, opts.original.length + 1, opts.original]);

  // Layout: TIFF header (8) | IFD0 | Exif IFD | string data
  const ifd0Size = 2 + (ifd0.length + (exif.length ? 1 : 0)) * 12 + 4;
  const exifSize = exif.length ? 2 + exif.length * 12 + 4 : 0;
  const ifd0At = 8;
  const exifAt = ifd0At + ifd0Size;
  let dataAt = exifAt + exifSize;
  const dataChunks: Array<{ at: number; s: string }> = [];
  const place = (s: string) => {
    const at = dataAt;
    dataChunks.push({ at, s });
    dataAt += s.length + 1;
    return at;
  };
  const stringBytes = [...ifd0, ...exif].reduce((n, [, , , value]) => n + (typeof value === "string" ? value.length + 1 : 0), 0);
  const tiffLen = dataAt + stringBytes;
  const tiff = new Uint8Array(tiffLen);
  const dv = new DataView(tiff.buffer);
  dv.setUint16(0, little ? 0x4949 : 0x4d4d);
  dv.setUint16(2, 0x2a, little);
  dv.setUint32(4, ifd0At, little);

  const writeIfd = (at: number, entries: Array<[number, number, number, number | string]>) => {
    dv.setUint16(at, entries.length, little);
    entries.forEach(([tag, type, count, value], i) => {
      const e = at + 2 + i * 12;
      dv.setUint16(e, tag, little);
      dv.setUint16(e + 2, type, little);
      dv.setUint32(e + 4, count, little);
      if (typeof value === "string") dv.setUint32(e + 8, place(value), little);
      else dv.setUint32(e + 8, value, little);
    });
    dv.setUint32(at + 2 + entries.length * 12, 0, little);
  };
  const ifd0Entries = [...ifd0];
  if (exif.length) ifd0Entries.push([0x8769, 4, 1, exifAt]);
  writeIfd(ifd0At, ifd0Entries);
  if (exif.length) writeIfd(exifAt, exif);
  strings.push(...dataChunks.map((c) => c.s));
  for (const { at, s } of dataChunks) {
    for (let i = 0; i < s.length; i++) tiff[at + i] = s.charCodeAt(i);
    tiff[at + s.length] = 0;
  }

  const app1Body = new Uint8Array(6 + tiffLen);
  app1Body.set([0x45, 0x78, 0x69, 0x66, 0, 0], 0); // "Exif\0\0"
  app1Body.set(tiff, 6);
  const segLen = app1Body.length + 2;
  const out = new Uint8Array(2 + 2 + 2 + app1Body.length + 2);
  out.set([0xff, 0xd8, 0xff, 0xe1, segLen >> 8, segLen & 0xff], 0);
  out.set(app1Body, 6);
  out.set([0xff, 0xd9], 6 + app1Body.length);
  return out.buffer;
}

describe("exifDateToIso", () => {
  it("converts the EXIF shape and rejects the unset one", () => {
    expect(exifDateToIso("2026:10:31 15:10:47")).toBe("2026-10-31T15:10:47");
    expect(exifDateToIso("0000:00:00 00:00:00")).toBeNull();
    expect(exifDateToIso("yesterday")).toBeNull();
  });
});

describe("exifTakenAt", () => {
  it("reads DateTimeOriginal from the Exif IFD, little-endian", () => {
    expect(exifTakenAt(jpegWithExif({ original: "2026:10:31 15:10:47", datetime: "2026:11:01 09:00:00" }))).toBe(
      "2026-10-31T15:10:47",
    );
  });
  it("reads big-endian too", () => {
    expect(exifTakenAt(jpegWithExif({ little: false, original: "2025:06:01 08:30:00" }))).toBe("2025-06-01T08:30:00");
  });
  it("falls back to IFD0 DateTime when there is no original", () => {
    expect(exifTakenAt(jpegWithExif({ datetime: "2026:11:01 09:00:00" }))).toBe("2026-11-01T09:00:00");
  });
  it("returns null for a JPEG without EXIF, a PNG, and garbage", () => {
    expect(exifTakenAt(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9]).buffer)).toBeNull();
    expect(exifTakenAt(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toBeNull();
    expect(exifTakenAt(new Uint8Array([1, 2]).buffer)).toBeNull();
  });
});
