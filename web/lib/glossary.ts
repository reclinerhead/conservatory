// The app teaches (#10). Every horticultural term a screen shows carries an
// info mark that opens one of these: two or three plain sentences, and a
// "more" link. Keyed by term; the Term component looks them up, and a test
// checks that every key the UI uses exists and that no entry runs long.
// Examples from the person's own collection are added by the component when
// it has them; the text here must stand on its own.

export type GlossaryEntry = {
  term: string; // how the word is shown
  text: string; // two or three sentences, plain language
  more?: string; // a Wikipedia article
};

export const GLOSSARY = {
  "scientific-name": {
    term: "scientific name",
    text: "The two-word Latin name every plant has, the same in every country and every nursery. The first word is the genus, the second the species, and it is always written in italics. It is the name the classifier looks for, and the one the care sheet is built on.",
    more: "https://en.wikipedia.org/wiki/Binomial_nomenclature",
  },
  genus: {
    term: "genus",
    text: "A group of closely related species, and the first word of a scientific name. Echeveria, Sedum and Ficus are genera. Care advice usually works at this level, so knowing the genus is most of the battle.",
    more: "https://en.wikipedia.org/wiki/Genus",
  },
  species: {
    term: "species",
    text: "One kind of plant within a genus, the second word of the scientific name. Ficus elastica is a species of Ficus. Many shelf plants are nursery hybrids with no species name at all, which is why the classifier can know the genus and still be unsure here.",
    more: "https://en.wikipedia.org/wiki/Species",
  },
  cultivar: {
    term: "cultivar",
    text: "A named variety a grower selected or bred, written in quotes after the genus or species: Echeveria 'Black Prince'. The name lives on the nursery tag, not in any classifier, so it is yours to type.",
    more: "https://en.wikipedia.org/wiki/Cultivar",
  },
  confidence: {
    term: "confidence",
    text: "How sure the classifier is, from its own point of view, that a photo shows this name. A high number with nothing close behind is a safe bet. Low numbers that all share a genus mean the genus is right and the species is a guess.",
    more: "https://plantnet.org/",
  },
  "common-name": {
    term: "common name",
    text: "The everyday name for a plant, such as rubber plant or jelly beans. Common names vary by region and one name can cover several species, which is why the scientific name is the one that counts.",
    more: "https://en.wikipedia.org/wiki/Common_name",
  },
  organ: {
    term: "organ",
    text: "The part of the plant a photo shows: leaf, flower, fruit or bark. Telling the classifier which part it is looking at helps it, and a flower photo added to a leaf photo often turns a guess into an answer.",
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;

export function entry(key: GlossaryKey): GlossaryEntry {
  return GLOSSARY[key];
}
