import { describe, expect, it } from "vitest";
import {
  aboutState,
  collectionRows,
  compareSpecies,
  filmStrip,
  inCollectionLine,
  latinRuns,
  matchesSpecies,
  namingLine,
  photoCountLine,
  plantLabel,
  rowDateLine,
  rowMeta,
  speciesCrumbs,
  speciesGallery,
  speciesTitle,
  specimenCount,
  stripCaption,
  type OwnerPhoto,
  type SpeciesListRow,
} from "./species-page";

const ficus = { commonName: "India Rubber Fig", scientificName: "Ficus elastica", cultivar: "Ruby", family: "Moraceae", genus: "Ficus", rank: "species" };

describe("speciesTitle", () => {
  it("leads with the common name and falls back to the scientific name with its cultivar", () => {
    expect(speciesTitle(ficus)).toBe("India Rubber Fig");
    expect(speciesTitle({ ...ficus, commonName: null })).toBe("Ficus elastica 'Ruby'");
  });
});

describe("speciesCrumbs", () => {
  it("walks Collection, family, genus, then the species", () => {
    expect(speciesCrumbs(ficus)).toEqual([
      { label: "Collection", href: "/" },
      { label: "Moraceae", href: "/?q=Moraceae" },
      { label: "Ficus", href: "/?q=Ficus", italic: true },
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

function photo(photoId: number, specimenId: number, takenAt: string | null, uploadedAt = "2026-10-01T00:00:00.000Z", chosen = false): OwnerPhoto {
  return { photoId, specimenId, path: `photos/2026/10/p${photoId}.jpg`, takenAt, uploadedAt, chosen };
}

const REF = { url: "/media/reference/1.jpg?v=x", thumbUrl: "/media/reference/1.thumb.jpg?v=x", credit: "Ficus elastica · Wikipedia", sourceUrl: "https://commons.wikimedia.org/wiki/File:F.jpg" };

describe("speciesGallery", () => {
  it("returns every photo of every plant, newest first across plants, then the reference", () => {
    const items = speciesGallery(
      [
        photo(1, 10, "2026-07-01T00:00:00Z"), // an older photo of specimen 10: in the gallery too (#123)
        photo(2, 10, "2026-07-12T00:00:00Z"),
        photo(3, 20, null, "2026-08-01T00:00:00Z"), // no EXIF date: its upload time counts
        photo(4, 30, "2026-05-01T00:00:00Z"),
      ],
      REF,
    );
    expect(items.map((i) => i.key)).toEqual(["photo-3", "photo-2", "photo-1", "photo-4", "reference"]);
    expect(items[1]).toMatchObject({
      kind: "owner",
      photoId: 2,
      specimenId: 10,
      at: "2026-07-12T00:00:00Z",
      url: "/media/photos/2026/10/p2.jpg",
      thumbUrl: "/media/photos/2026/10/p2.thumb.jpg",
      href: "/plants/10",
      caption: "Your photo · Plant #10 · Jul 12, 2026",
      alt: "Your photo of plant #10",
    });
    expect(items[4]).toMatchObject({ kind: "reference", href: REF.sourceUrl, caption: "Reference · Ficus elastica · Wikipedia" });
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

  it("with nothing chosen for the species, leads with the newest of the plants' main photos, then every other photo newest first", () => {
    const items = speciesGallery(
      [
        photo(1, 10, "2026-03-01T00:00:00Z", undefined, true), // chosen as plant 10's main photo
        photo(2, 10, "2026-07-12T00:00:00Z"), // newer, but not the one plant 10 is known by
        photo(3, 20, "2026-05-01T00:00:00Z"),
      ],
      REF,
    );
    // Plant 20's main photo (May) is newer than plant 10's (March), so it leads; photo 2 follows in its date place.
    expect(items.map((i) => i.key)).toEqual(["photo-3", "photo-2", "photo-1", "reference"]);
  });

  it("picks the lead among the plants by the date of the photo each is known by", () => {
    const items = speciesGallery(
      [
        photo(1, 10, "2026-09-01T00:00:00Z", undefined, true),
        photo(2, 20, "2026-02-01T00:00:00Z", undefined, true),
        photo(3, 20, "2026-10-01T00:00:00Z"), // the newest photo of all, but plant 20 is known by photo 2
        photo(4, 30, "2026-06-01T00:00:00Z"), // nothing chosen: its newest
      ],
      null,
    );
    expect(items.map((i) => i.key)).toEqual(["photo-1", "photo-3", "photo-4", "photo-2"]);
  });

  it("leads with a plant's newest when none of its photos is chosen, and keeps the reference last", () => {
    const items = speciesGallery([photo(1, 10, "2026-01-01T00:00:00Z"), photo(2, 10, "2026-02-01T00:00:00Z"), photo(3, 20, "2025-01-01T00:00:00Z", undefined, true)], REF);
    expect(items.map((i) => i.key)).toEqual(["photo-2", "photo-1", "photo-3", "reference"]);
  });

  it("leads with the photo chosen for the species, and does not repeat it", () => {
    const items = speciesGallery(
      [photo(1, 10, "2026-03-01T00:00:00Z"), photo(2, 20, "2026-07-12T00:00:00Z"), photo(3, 30, "2026-05-01T00:00:00Z")],
      REF,
      1,
    );
    expect(items.map((i) => i.key)).toEqual(["photo-1", "photo-2", "photo-3", "reference"]);
    expect(items[0]).toMatchObject({ kind: "owner", photoId: 1, href: "/plants/10" });
  });

  it("can lead with a photo that is not its plant's main photo, and still shows that plant's others", () => {
    const items = speciesGallery(
      [
        photo(1, 10, "2026-03-01T00:00:00Z"), // chosen for the species
        photo(2, 10, "2026-07-12T00:00:00Z", undefined, true), // plant 10's main photo
        photo(3, 20, "2026-09-01T00:00:00Z"),
      ],
      REF,
      1,
    );
    expect(items.map((i) => i.key)).toEqual(["photo-1", "photo-3", "photo-2", "reference"]);
  });

  it("ignores a chosen photo that is not on a plant of this species", () => {
    const photos = [photo(1, 10, "2026-03-01T00:00:00Z"), photo(2, 20, "2026-07-12T00:00:00Z")];
    expect(speciesGallery(photos, REF, 99)).toEqual(speciesGallery(photos, REF));
    expect(speciesGallery(photos, REF, null).map((i) => i.key)).toEqual(["photo-2", "photo-1", "reference"]);
    expect(speciesGallery([], REF, 99).map((i) => i.kind)).toEqual(["reference"]);
  });

  it("links the reference to its image when Commons gave no page", () => {
    expect(speciesGallery([], { ...REF, credit: null, sourceUrl: null })[0]).toMatchObject({ href: REF.url, caption: "Reference · Wikipedia" });
  });
});

describe("filmStrip", () => {
  it("puts the species photo back in its date position, newest first, the reference last", () => {
    const gallery = speciesGallery(
      [photo(1, 10, "2026-03-01T00:00:00Z"), photo(2, 20, "2026-07-12T00:00:00Z"), photo(3, 30, "2026-05-01T00:00:00Z"), photo(4, 10, "2026-05-01T00:00:00Z")],
      REF,
      1,
    );
    expect(gallery.map((i) => i.key)).toEqual(["photo-1", "photo-2", "photo-4", "photo-3", "reference"]);
    expect(filmStrip(gallery).map((i) => i.key)).toEqual(["photo-2", "photo-4", "photo-3", "photo-1", "reference"]);
    expect(gallery[0].key).toBe("photo-1"); // the lightbox's order is left as it was
  });
  it("is the reference alone, or nothing, without a photo of the household's", () => {
    expect(filmStrip(speciesGallery([], REF)).map((i) => i.key)).toEqual(["reference"]);
    expect(filmStrip([])).toEqual([]);
  });
});

describe("stripCaption", () => {
  it("gives the plant number and the day, with the year only when it is not this one", () => {
    expect(stripCaption({ kind: "owner", specimenId: 281, at: "2026-11-20T15:04:05Z" }, "2026-11-22")).toBe("#281 · Nov 20");
    expect(stripCaption({ kind: "owner", specimenId: 281, at: "2025-05-20T15:04:05Z" }, "2026-11-22")).toBe("#281 · May 20, 2025");
    expect(stripCaption({ kind: "owner", specimenId: 281, at: "2026-11-20T15:04:05Z" }, "2027-01-02")).toBe("#281 · Nov 20, 2026");
  });
  it("says Wikipedia under the reference, and the number alone without a date", () => {
    expect(stripCaption({ kind: "reference" }, "2026-11-22")).toBe("Wikipedia");
    expect(stripCaption({ kind: "owner", specimenId: 7, at: "nonsense" }, "2026-11-22")).toBe("#7");
  });
});

describe("In your collection's rows", () => {
  it("calls a plant by its number", () => {
    expect(plantLabel(281)).toBe("Plant #281");
  });
  it("dates a row to the day: since when it was acquired, else when it was added", () => {
    expect(rowDateLine({ acquiredOn: "2025-05-20", createdAt: "2026-11-22T14:00:00.000Z" })).toBe("since May 20, 2025");
    expect(rowDateLine({ acquiredOn: null, createdAt: "2026-11-22T14:00:00.000Z" })).toBe("added Nov 22, 2026");
  });
  it("counts a plant's photos: none, one, many", () => {
    expect(photoCountLine(0)).toBe("No photos yet");
    expect(photoCountLine(1)).toBe("1 photo");
    expect(photoCountLine(9)).toBe("9 photos");
  });
  it("gives the location, the date and the photo count, in that order", () => {
    expect(rowMeta({ location: "Front bed", acquiredOn: "2025-05-20", createdAt: "2026-11-22T14:00:00.000Z" }, 9)).toEqual(["Front bed", "since May 20, 2025", "9 photos"]);
    expect(rowMeta({ location: null, acquiredOn: null, createdAt: "2026-11-22T14:00:00.000Z" }, 0)).toEqual(["No location yet", "added Nov 22, 2026", "No photos yet"]);
  });
  it("orders the living first and newest first, then the gifted, then the dead", () => {
    const rows = collectionRows([
      { id: 1, status: "died" as const, createdAt: "2026-09-01T00:00:00.000Z" },
      { id: 2, status: "alive" as const, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: 3, status: "gifted" as const, createdAt: "2026-02-01T00:00:00.000Z" },
      { id: 4, status: "alive" as const, createdAt: "2026-06-01T00:00:00.000Z" },
      { id: 5, status: "alive" as const, createdAt: "2026-06-01T00:00:00.000Z" }, // the same second: the newer id first
      { id: 6, status: "gifted" as const, createdAt: "2026-08-01T00:00:00.000Z" },
    ]);
    expect(rows.map((r) => r.id)).toEqual([5, 4, 2, 6, 3, 1]);
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
  return { id, scientificName: `Genus sp${id}`, cultivar: null, commonName: null, canonicalName: null, family: null, genus: null, specimens, places: [], gone: 0, latest: null, addedAt: "2026-01-01T00:00:00.000Z", hasSummary: false, thumbUrl: null, imageUrl: null, ...over };
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
