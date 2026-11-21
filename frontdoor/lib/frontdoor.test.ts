import { describe, expect, it } from "vitest";

import { buildTarget, describeAge, isValidSlug } from "./frontdoor";

describe("isValidSlug", () => {
  it("accepts lowercase hostname-safe ids", () => {
    for (const s of ["birdhouse", "kestrel", "lakehouse", "station-3", "a1"]) {
      expect(isValidSlug(s)).toBe(true);
    }
  });
  it("rejects everything else", () => {
    for (const s of ["", "Birdhouse", "bird_house", "-lead", "a.b", "a/b", "..", "api ", 42, null]) {
      expect(isValidSlug(s)).toBe(false);
    }
  });
});

describe("buildTarget", () => {
  const ip = "192.168.1.120";

  it("lands on /conservatory with no path, and never on the box's root", () => {
    expect(buildTarget(ip, undefined)).toBe("http://192.168.1.120/conservatory");
    expect(buildTarget(ip, [])).toBe("http://192.168.1.120/conservatory");
  });
  it("joins a path under the prefix", () => {
    expect(buildTarget(ip, ["plants", "1"])).toBe("http://192.168.1.120/conservatory/plants/1");
    expect(buildTarget(ip, ["tags"])).toBe("http://192.168.1.120/conservatory/tags");
  });
  it("carries a pot tag's path, so a printed tag opens its plant", () => {
    expect(buildTarget(ip, ["t", "12"])).toBe("http://192.168.1.120/conservatory/t/12");
  });
  it("carries the query string", () => {
    expect(buildTarget(ip, [], "?q=Crassulaceae")).toBe("http://192.168.1.120/conservatory?q=Crassulaceae");
    expect(buildTarget(ip, ["tags"], "?species=4")).toBe("http://192.168.1.120/conservatory/tags?species=4");
  });
  it("ignores a malformed query string", () => {
    expect(buildTarget(ip, [], "?")).toBe("http://192.168.1.120/conservatory");
    expect(buildTarget(ip, [], "q=Crassulaceae")).toBe("http://192.168.1.120/conservatory");
  });
  it("encodes segments so nothing can escape the station's Conservatory", () => {
    expect(buildTarget(ip, ["a b", "c?d"])).toBe("http://192.168.1.120/conservatory/a%20b/c%3Fd");
    expect(buildTarget(ip, ["evil.example:80"])).toBe("http://192.168.1.120/conservatory/evil.example%3A80");
    expect(buildTarget(ip, ["@evil.example"])).toBe("http://192.168.1.120/conservatory/%40evil.example");
    expect(buildTarget(ip, ["#frag"])).toBe("http://192.168.1.120/conservatory/%23frag");
    // A slash inside a segment is refused, not encoded (see the dot-segment case below).
    expect(buildTarget(ip, ["//evil.example"])).toBeNull();
  });
  it("refuses dot segments, empty segments and backslashes", () => {
    expect(buildTarget(ip, [".."])).toBeNull();
    expect(buildTarget(ip, ["plants", "."])).toBeNull();
    expect(buildTarget(ip, ["plants", "..", "etc"])).toBeNull();
    expect(buildTarget(ip, [""])).toBeNull();
    expect(buildTarget(ip, ["a/b"])).toBeNull();
    expect(buildTarget(ip, ["a\\b"])).toBeNull();
  });
  it("refuses a record whose address is not a literal IPv4", () => {
    for (const bad of ["evil.example", "192.168.1", "192.168.01.5", "192.168.1.256", "::1", "", "192.168.1.120/", "192.168.1.120@x"]) {
      expect(buildTarget(bad, [])).toBeNull();
    }
  });
  it("caps the path's length and depth", () => {
    expect(buildTarget(ip, Array(17).fill("a"))).toBeNull();
    expect(buildTarget(ip, ["a".repeat(201)])).toBeNull();
    expect(buildTarget(ip, Array(16).fill("a"))).toMatch(/^http:\/\/192\.168\.1\.120\/conservatory\/a(\/a){15}$/);
  });
  it("never produces a target off http://<ip>/conservatory", () => {
    const cases: Array<[readonly string[] | undefined, string]> = [
      [undefined, ""],
      [[], "?x=1"],
      [["plants", "1"], ""],
      [["http:", "evil.example"], ""],
      [["..%2F..", "etc"], "?a=b"],
      [["%2e%2e"], ""],
      [["evil.example#"], "?#"],
    ];
    for (const [segments, search] of cases) {
      const target = buildTarget(ip, segments, search);
      if (target === null) continue;
      expect(target.startsWith("http://192.168.1.120/conservatory")).toBe(true);
      const url = new URL(target);
      expect(url.host).toBe("192.168.1.120");
      expect(url.pathname === "/conservatory" || url.pathname.startsWith("/conservatory/")).toBe(true);
    }
  });
});

describe("describeAge", () => {
  const now = new Date("2026-11-08T12:00:00Z");
  it("speaks in the largest sensible unit", () => {
    expect(describeAge("2026-11-08T11:59:59Z", now)).toBe("1 second ago");
    expect(describeAge("2026-11-08T11:59:20Z", now)).toBe("40 seconds ago");
    expect(describeAge("2026-11-08T11:45:00Z", now)).toBe("15 minutes ago");
    expect(describeAge("2026-11-08T09:00:00Z", now)).toBe("3 hours ago");
    expect(describeAge("2026-11-05T12:00:00Z", now)).toBe("3 days ago");
  });
  it("never goes negative and survives garbage", () => {
    expect(describeAge("2026-11-08T12:00:05Z", now)).toBe("0 seconds ago");
    expect(describeAge("not a date", now)).toBe("unknown");
  });
});
