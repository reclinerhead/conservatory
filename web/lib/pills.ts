// What the confirm screen shows for a job's candidates. Pure; the rules come
// from Phase 0 (#1) and epic #4:
//
//   1. A shelf succulent often comes back as three species of one genus at
//      tiny scores. When the top three species agree on a genus and the best
//      species score is still low, the genus leads: "Echeveria, species
//      unsure". The person can stop at the genus; the species pills follow.
//   2. When the best score is very low AND the top three disagree on genus
//      (photo 13: three genera under 0.07), nothing is worth leading with:
//      the name field goes first and the pills second.
//   3. Scores stay visible on every pill.

import type { JobCandidate } from "@/app/api/jobs/[id]/route";

export const GENUS_LEADS_BELOW = 0.3; // best species score under this, with agreeing genera, puts the genus first
export const LOW_CONFIDENCE_BELOW = 0.1; // best species score under this, with disagreeing genera, puts the name field first
export const MAX_PILLS = 3;

export type Pill = {
  kind: "species" | "genus";
  rank: number; // the candidate's rank within its kind; what the confirmation records
  scientificName: string;
  genus: string | null;
  family: string | null;
  score: number;
  commonName: string | null;
  note: string | null; // "species unsure" on a leading genus pill
};

export type PillPlan = {
  pills: Pill[];
  lowConfidence: boolean; // name field first
  genusLeads: boolean;
};

function toPill(c: JobCandidate, note: string | null = null): Pill {
  return {
    kind: c.kind === "genus" ? "genus" : "species",
    rank: c.rank,
    scientificName: c.scientificName,
    genus: c.genus,
    family: c.family,
    score: c.score,
    commonName: c.commonNames[0] ?? null,
    note,
  };
}

export function planPills(candidates: JobCandidate[]): PillPlan {
  const species = candidates.filter((c) => c.kind === "species").sort((a, b) => a.rank - b.rank);
  const genera = candidates.filter((c) => c.kind === "genus").sort((a, b) => a.rank - b.rank);
  if (species.length === 0) return { pills: [], lowConfidence: true, genusLeads: false };

  const top = species.slice(0, MAX_PILLS);
  const best = top[0].score;
  const topGenera = new Set(top.map((c) => c.genus ?? ""));
  const agree = topGenera.size === 1 && top[0].genus;

  if (best < LOW_CONFIDENCE_BELOW && !agree) {
    return { pills: top.map((c) => toPill(c)), lowConfidence: true, genusLeads: false };
  }

  if (agree && best < GENUS_LEADS_BELOW) {
    const genusRow = genera.find((g) => g.scientificName === top[0].genus);
    const genusScore = genusRow?.score ?? Math.min(1, top.reduce((s, c) => s + c.score, 0));
    const genusPill: Pill = {
      kind: "genus",
      rank: genusRow?.rank ?? 1,
      scientificName: top[0].genus!,
      genus: top[0].genus,
      family: top[0].family,
      score: genusScore,
      commonName: null,
      note: "species unsure",
    };
    return { pills: [genusPill, ...top.slice(0, MAX_PILLS - 1).map((c) => toPill(c))], lowConfidence: false, genusLeads: true };
  }

  return { pills: top.map((c) => toPill(c)), lowConfidence: false, genusLeads: false };
}

/** "67%" for a pill; never "0%" for something that was suggested. */
export function percent(score: number): string {
  return `${Math.max(1, Math.round(score * 100))}%`;
}
