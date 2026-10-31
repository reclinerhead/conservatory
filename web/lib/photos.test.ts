import { describe, expect, it } from "vitest";
import { contentTypeFor, extForMime, isOrgan, mediaRelPath, relPathFor, thumbPathFor } from "./photos";

describe("relPathFor", () => {
  it("files by upload year and month in UTC", () => {
    expect(relPathFor("abc", "jpg", new Date("2026-10-31T23:30:00Z"))).toBe("photos/2026/10/abc.jpg");
    expect(relPathFor("abc", "heic", new Date("2026-01-05T00:00:00Z"))).toBe("photos/2026/01/abc.heic");
  });
});

describe("thumbPathFor", () => {
  it("mirrors Fern's thumb_path", () => {
    expect(thumbPathFor("photos/2026/10/abc.jpg")).toBe("photos/2026/10/abc.thumb.jpg");
    expect(thumbPathFor("photos/2026/10/abc.heic")).toBe("photos/2026/10/abc.thumb.jpg");
  });
});

describe("extForMime and isOrgan", () => {
  it("maps known types and falls back to jpg", () => {
    expect(extForMime("image/jpeg")).toBe("jpg");
    expect(extForMime("image/HEIC")).toBe("heic");
    expect(extForMime("application/octet-stream")).toBe("jpg");
    expect(extForMime(null)).toBe("jpg");
  });
  it("accepts only the five organ tags", () => {
    expect(isOrgan("leaf")).toBe(true);
    expect(isOrgan("auto")).toBe(true);
    expect(isOrgan("root")).toBe(false);
    expect(isOrgan(3)).toBe(false);
  });
});

describe("mediaRelPath", () => {
  it("accepts exactly the shape relPathFor writes", () => {
    expect(mediaRelPath(["photos", "2026", "10", "abc.jpg"])).toBe("photos/2026/10/abc.jpg");
    expect(mediaRelPath(["photos", "2026", "10", "abc.thumb.jpg"])).toBe("photos/2026/10/abc.thumb.jpg");
  });
  it("refuses anything else", () => {
    expect(mediaRelPath(["photos", "2026", "abc.jpg"])).toBeNull();
    expect(mediaRelPath(["clips", "2026", "10", "abc.jpg"])).toBeNull();
    expect(mediaRelPath(["photos", "..", "10", "abc.jpg"])).toBeNull();
    expect(mediaRelPath(["photos", "2026", "10", ".abc.jpg"])).toBeNull();
    expect(mediaRelPath(["photos", "2026", "10", "abc.exe"])).toBeNull();
    expect(mediaRelPath(["photos", "2026", "10", "a b.jpg"])).toBeNull();
  });
});

describe("contentTypeFor", () => {
  it("knows the three servable types", () => {
    expect(contentTypeFor("photos/2026/10/a.jpg")).toBe("image/jpeg");
    expect(contentTypeFor("photos/2026/10/a.png")).toBe("image/png");
    expect(contentTypeFor("photos/2026/10/a.heic")).toBe("image/heic");
  });
});
