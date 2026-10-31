import { describe, expect, it } from "vitest";
import {
  aboutState,
  compareSpecies,
  displayName,
  galleryLine,
  inCollectionLine,
  latinRuns,
  matchesSpecies,
  namingLine,
  speciesCrumbs,
  speciesGallery,
  speciesLedger,
  speciesTitle,
  specimenCount,
  type OwnerPhoto,
  type SpeciesListRow,
} from "./species-page";

const ficus = { commonName: "India Rubber Fig", scientificName: "Ficus elastica", cultivar: "Ruby", family: "Moraceae", genus: "Ficus", rank: "species" };

describe("displayName and speciesTitle", () => {
  it("capitalises GBIF's vernacular and falls back to the scientific name with its cultivar", () => {
    expect(displayName("echeveria")).toBe("Echeveria");
    expect(displayName("  ")).toBeNull();
    expect(displayName(null)).toBeNull();
    expect(speciesTitle(ficus)).toBe("India Rubber Fig");
    expect(speciesTitle({ ...ficus, commonName: null })).toBe("Ficus elastica 'Ruby'");
  });
});

describe("speciesCrumbs", () => {
  it("walks Collection, family, genus, then the species", () => {
    expect(speciesCrumbs(ficus)).toEqual([
      { label: "Collection", href: "/" },
      { label: "Moraceae", href: "/species?q=Moraceae" },
      { label: "Ficus", href: "/species?q=Ficus", italic: true },
      { label: "India Rubber Fig", italic: false, current: true },
    ]);
  });
  it("skips a rank Fern has not filled, never fakes it", () => {
    const bare = { commonName: null, scientificName: "Blorbus nonsensicus", cultivar: null, family: null, genus: null, rank: null };
    expect(speciesCrumbs(bare)).toEqual([
      { label: "Collection", href: "/" },
      { label: "Blorbus nonsensicus", italic: true, current: true },
    ]);
    expect(speciesCrumbs({ ...ficus, family: null }).map((c) => c.label)).toEqual(["Collection", "Ficus", "India Rubber Fig"]);
  });
  it("skips the genus for a species that is itself a genus", () => {
    const echeveria = { commonName: "echeveria", scientificName: "Echeveria", cultivar: "Black Prince", family: "Crassulaceae", genus: "Echeveria", rank: "genus" };
    expect(speciesCrumbs(echeveria).map((c) => c.label)).toEqual(["Collection", "Crassulaceae", "Echeveria"]);
  });
});

function photo(photoId: number, specimenId: number, takenAt: string | null, uploadedAt = "2026-10-01T00:00:00.000Z"): OwnerPhoto {
  return { photoId, specimenId, specimenName: `Plant ${specimenId}`, path: `photos/2026/10/p${photoId}.jpg`, takenAt, uploadedAt };
}

const REF = { url: "/media/reference/1.jpg?v=x", thumbUrl: "/media/reference/1.thumb.jpg?v=x", credit: "Ficus elastica · Wikipedia", sourceUrl: "https://commons.wikimedia.org/wiki/File:F.jpg" };

describe("speciesGallery", () => {
  it("takes the newest photo of each specimen, newest first, then the reference", () => {
    const items = speciesGallery(
      [
        photo(1, 10, "2026-07-01T00:00:00Z"),
        photo(2, 10, "2026-07-12T00:00:00Z"), // newest of specimen 10
        photo(3, 20, null, "2026-08-01T00:00:00Z"), // no EXIF date: its upload time counts
        photo(4, 30, "2026-05-01T00:00:00Z"),
      ],
      REF,
    );
    expect(items.map((i) => i.key)).toEqual(["photo-3", "photo-2", "photo-4", "reference"]);
    expect(items[1]).toMatchObject({
      kind: "owner",
      url: "/media/photos/2026/10/p2.jpg",
      thumbUrl: "/media/photos/2026/10/p2.thumb.jpg",
      href: "/plants/10",
      caption: "Your photo · Plant 10 · Jul 12, 2026",
      short: "Plant 10",
    });
    expect(items[3]).toMatchObject({ kind: "reference", href: REF.sourceUrl, caption: "Reference · Ficus elastica · Wikipedia", short: "Wikipedia" });
  });

  it("breaks a tie on the date by the newer photo id", () => {
    const items = speciesGallery([photo(5, 1, "2026-07-12T00:00:00Z"), photo(6, 2, "2026-07-12T00:00:00Z")], null);
    expect(items.map((i) => i.key)).toEqual(["photo-6", "photo-5"]);
  });

  it("makes the reference the hero only when there is no photo of the household's", () => {
    expect(speciesGallery([], REF).map((i) => i.kind)).toEqual(["reference"]);
    expect(speciesGallery([photo(1, 1, null)], REF)[0].kind).toBe("owner");
    expect(speciesGallery([], null)).toEqual([]);
  });

  it("links the reference to its image when Commons gave no page", () => {
    expect(speciesGallery([], { ...REF, credit: null, sourceUrl: null })[0]).toMatchObject({ href: REF.url, caption: "Reference · Wikipedia" });
  });
});

describe("galleryLine", () => {
  it("counts the owner's photos and the reference", () => {
    expect(galleryLine(2, true)).toBe("2 of your photos · 1 reference image");
    expect(galleryLine(1, false)).toBe("1 of your photos");
    expect(galleryLine(0, true)).toBe("No photos of yours yet · 1 reference image");
  });
});

describe("aboutState", () => {
  it("splits the summary into paragraphs", () => {
    expect(aboutState({ enrichedAt: "x", summary: "One.\n\nTwo.\nThree.", gbifKey: 1 })).toEqual({ kind: "summary", paragraphs: ["One.", "Two.", "Three."] });
  });
  it("is pending until Fern has looked, then says Wikipedia had nothing", () => {
    expect(aboutState({ enrichedAt: null, summary: null, gbifKey: null })).toEqual({ kind: "pending" });
    expect(aboutState({ enrichedAt: "x", summary: null, gbifKey: 5 })).toEqual({ kind: "no-page", unknownToGbif: false });
    expect(aboutState({ enrichedAt: "x", summary: "  ", gbifKey: null })).toEqual({ kind: "no-page", unknownToGbif: true });
  });
});

describe("latinRuns", () => {
  it("marks the species' own Latin names, longest first, whole words only", () => {
    expect(latinRuns("Ficus elastica, the rubber fig, is a Ficus of the family Moraceae.", ["Ficus elastica", "Ficus", null])).toEqual([
      { text: "Ficus elastica", latin: true },
      { text: ", the rubber fig, is a ", latin: false },
      { text: "Ficus", latin: true },
      { text: " of the family Moraceae.", latin: false },
    ]);
    expect(latinRuns("Sedums and Sedum", ["Sedum"])).toEqual([
      { text: "Sedums and ", latin: false },
      { text: "Sedum", latin: true },
    ]);
  });
  it("leaves the text alone when there are no names", () => {
    expect(latinRuns("Plain.", [null, "", "ab"])).toEqual([{ text: "Plain.", latin: false }]);
  });
});

describe("counts lines", () => {
  it("says how many, where, and how many are gone", () => {
    expect(specimenCount(0)).toBe("None living");
    expect(specimenCount(1)).toBe("1 specimen");
    expect(specimenCount(3)).toBe("3 specimens");
    expect(
      inCollectionLine([
        { status: "alive", location: "Front bed" },
        { status: "alive", location: "Front bed" },
        { status: "alive", location: "Mailbox bed" },
        { status: "died", location: "Front bed" },
      ]),
    ).toBe("3 specimens · 2 locations · 1 no longer here");
    expect(inCollectionLine([{ status: "alive", location: null }])).toBe("1 specimen");
    expect(speciesLedger([{ family: "Moraceae" }, { family: "Crassulaceae" }, { family: "Crassulaceae" }, { family: null }])).toBe("4 species · 2 families");
    expect(speciesLedger([{ family: "Moraceae" }])).toBe("1 species · 1 family");
  });
});

describe("namingLine", () => {
  it("says how the species came in", () => {
    expect(namingLine({ how: "pill", score: 0.912, at: "2026-10-28T12:00:00Z" })).toBe("Identified by Fern via Pl@ntNet at 91% · confirmed by you Oct 28, 2026");
    expect(namingLine({ how: "pill", score: null, at: "2026-10-28T12:00:00Z" })).toBe("Picked from Fern's suggestions on Oct 28, 2026");
    expect(namingLine({ how: "typed", score: null, at: "2026-10-28T12:00:00Z" })).toBe("You typed this name on Oct 28, 2026");
    expect(namingLine(null)).toBeNull();
  });
});

function row(id: number, specimens: number, over: Partial<SpeciesListRow> = {}): SpeciesListRow {
  return { id, scientificName: `Genus sp${id}`, cultivar: null, commonName: null, canonicalName: null, family: null, genus: null, specimens, thumbUrl: null, ...over };
}

describe("the species list", () => {
  it("sorts most owned first, then by name, ignoring case", () => {
    const rows = [
      row(1, 1, { commonName: "jellybeans" }),
      row(2, 3, { commonName: "Zebra plant" }),
      row(3, 1, { commonName: "India Rubber Fig" }),
      row(4, 1, { scientificName: "Aloe vera" }),
    ].sort(compareSpecies);
    expect(rows.map((r) => r.id)).toEqual([2, 4, 3, 1]);
  });

  it("matches common name, scientific name with cultivar, genus or family, any part, any case", () => {
    const r = row(1, 1, { commonName: "India Rubber Fig", scientificName: "Ficus elastica", cultivar: "Ruby", genus: "Ficus", family: "Moraceae", canonicalName: "Ficus elastica" });
    for (const q of ["", "  ", "rubber", "ELASTICA", "'ruby'", "ficus", "moraceae"]) expect(matchesSpecies(r, q), q).toBe(true);
    expect(matchesSpecies(r, "sedum")).toBe(false);
  });
});
