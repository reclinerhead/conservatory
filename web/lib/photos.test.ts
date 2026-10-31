import { describe, expect, it } from "vitest";
import { contentTypeFor, extForMime, isOrgan, mediaRelPath, referenceUrls, relPathFor, thumbPathFor } from "./photos";

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
  it("accepts a species' reference image and its thumbnail, exactly as Fern names them", () => {
    expect(mediaRelPath(["reference", "1.jpg"])).toBe("reference/1.jpg");
    expect(mediaRelPath(["reference", "12.thumb.jpg"])).toBe("reference/12.thumb.jpg");
  });
  it("refuses anything else under reference/", () => {
    expect(mediaRelPath(["reference", "a.jpg"])).toBeNull();
    expect(mediaRelPath(["reference", "1.png"])).toBeNull();
    expect(mediaRelPath(["reference", "..", "1.jpg"])).toBeNull();
    expect(mediaRelPath(["reference", "1.jpg.exe"])).toBeNull();
    expect(mediaRelPath(["reference", ".1.jpg"])).toBeNull();
    expect(mediaRelPath(["reference"])).toBeNull();
    expect(mediaRelPath(["reference", "2026", "10", "1.jpg"])).toBeNull();
  });
});

describe("referenceUrls", () => {
  it("carries the enrichment stamp so a re-fetched image is a new URL", () => {
    expect(referenceUrls("reference/1.jpg", "2026-10-31T19:39:24.355Z")).toEqual({
      url: "/media/reference/1.jpg?v=2026-10-31T19%3A39%3A24.355Z",
      thumbUrl: "/media/reference/1.thumb.jpg?v=2026-10-31T19%3A39%3A24.355Z",
    });
    expect(referenceUrls("reference/1.jpg", null)).toEqual({ url: "/media/reference/1.jpg", thumbUrl: "/media/reference/1.thumb.jpg" });
    expect(referenceUrls(null, "x")).toBeNull();
  });
});

describe("contentTypeFor", () => {
  it("knows the three servable types", () => {
    expect(contentTypeFor("photos/2026/10/a.jpg")).toBe("image/jpeg");
    expect(contentTypeFor("photos/2026/10/a.png")).toBe("image/png");
    expect(contentTypeFor("photos/2026/10/a.heic")).toBe("image/heic");
  });
});
