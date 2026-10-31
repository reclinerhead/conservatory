// The one EXIF field the Conservatory wants from a phone photo: when it was
// taken. The browser re-encodes photos before upload and the re-encode drops
// EXIF, so the date is read here, client-side, from the original bytes.
// A minimal JPEG APP1 walk: no library, nothing else parsed.

const TAG_EXIF_IFD = 0x8769;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_DATETIME = 0x0132;

/** "2026:10:31 15:10:47" (EXIF) -> "2026-10-31T15:10:47" (ISO, local time, no zone). */
export function exifDateToIso(s: string): string | null {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  if (y === "0000" || mo === "00" || d === "00") return null;
  return `${y}-${mo}-${d}T${h}:${mi}:${se}`;
}

/** DateTimeOriginal from a JPEG's EXIF, as ISO, or null when absent or unreadable. */
export function exifTakenAt(buf: ArrayBuffer): string | null {
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
  let off = 2;
  while (off + 4 <= v.byteLength) {
    if (v.getUint8(off) !== 0xff) return null;
    const marker = v.getUint8(off + 1);
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      off += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return null; // image data; no EXIF after this
    const len = v.getUint16(off + 2);
    if (marker === 0xe1 && off + 10 <= v.byteLength && readAscii(v, off + 4, 4) === "Exif") {
      return readTiff(v, off + 10, off + 2 + len);
    }
    off += 2 + len;
  }
  return null;
}

function readAscii(v: DataView, at: number, n: number): string {
  let s = "";
  for (let i = 0; i < n && at + i < v.byteLength; i++) {
    const c = v.getUint8(at + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

function readTiff(v: DataView, tiff: number, end: number): string | null {
  if (tiff + 8 > end) return null;
  const order = v.getUint16(tiff);
  const little = order === 0x4949;
  if (!little && order !== 0x4d4d) return null;
  const u16 = (at: number) => v.getUint16(at, little);
  const u32 = (at: number) => v.getUint32(at, little);
  if (u16(tiff + 2) !== 0x2a) return null;
  const ifd0 = tiff + u32(tiff + 4);

  const readIfd = (at: number): Map<number, { type: number; count: number; valueAt: number }> => {
    const entries = new Map<number, { type: number; count: number; valueAt: number }>();
    if (at + 2 > end) return entries;
    const n = u16(at);
    for (let i = 0; i < n; i++) {
      const e = at + 2 + i * 12;
      if (e + 12 > end) break;
      const tag = u16(e);
      const type = u16(e + 2);
      const count = u32(e + 4);
      const size = typeSize(type) * count;
      const valueAt = size > 4 ? tiff + u32(e + 8) : e + 8;
      entries.set(tag, { type, count, valueAt });
    }
    return entries;
  };

  const ascii = (f: { type: number; count: number; valueAt: number } | undefined): string | null => {
    if (!f || f.type !== 2 || f.valueAt + f.count > end) return null;
    return readAscii(v, f.valueAt, f.count);
  };

  const main = readIfd(ifd0);
  const exifPtr = main.get(TAG_EXIF_IFD);
  if (exifPtr && (exifPtr.type === 4 || exifPtr.type === 3)) {
    const sub = readIfd(tiff + u32(exifPtr.valueAt));
    const dto = ascii(sub.get(TAG_DATETIME_ORIGINAL));
    const iso = dto && exifDateToIso(dto);
    if (iso) return iso;
  }
  const dt = ascii(main.get(TAG_DATETIME));
  return dt ? exifDateToIso(dt) : null;
}

function typeSize(type: number): number {
  switch (type) {
    case 1:
    case 2:
    case 6:
    case 7:
      return 1;
    case 3:
    case 8:
      return 2;
    case 4:
    case 9:
    case 11:
      return 4;
    case 5:
    case 10:
    case 12:
      return 8;
    default:
      return 1;
  }
}
