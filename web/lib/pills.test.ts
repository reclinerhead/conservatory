import { describe, expect, it } from "vitest";
import type { JobCandidate } from "@/app/api/jobs/[id]/route";
import { percent, planPills } from "./pills";

function sp(rank: number, name: string, genus: string, score: number, common: string[] = []): JobCandidate {
  return { kind: "species", rank, scientificName: name, genus, family: "F", score, gbifId: null, commonNames: common };
}
function gen(rank: number, name: string, score: number): JobCandidate {
  return { kind: "genus", rank, scientificName: name, genus: name, family: "F", score, gbifId: null, commonNames: [] };
}

// The three shapes from the Phase 0 run (#1).
const FICUS = [sp(1, "Ficus elastica", "Ficus", 0.8, ["Rubber Plant"]), sp(2, "Ficus robusta", "Ficus", 0.04), sp(3, "Ficus rubiginosa", "Ficus", 0.003), gen(1, "Ficus", 0.84)];
const ECHEVERIA = [sp(1, "Echeveria gigantea", "Echeveria", 0.03), sp(2, "Echeveria pulidonis", "Echeveria", 0.02), sp(3, "Echeveria secunda", "Echeveria", 0.02), sp(4, "Sedum album", "Sedum", 0.01), gen(1, "Echeveria", 0.52), gen(2, "Sedum", 0.1)];
const UNSURE = [sp(1, "Aeonium castello-paivae", "Aeonium", 0.06), sp(2, "Echeveria derenbergii", "Echeveria", 0.05), sp(3, "Crassula mesembryanthemopsis", "Crassula", 0.04)];

describe("planPills", () => {
  it("leads with the species when the top one is confident", () => {
    const plan = planPills(FICUS);
    expect(plan.lowConfidence).toBe(false);
    expect(plan.genusLeads).toBe(false);
    expect(plan.pills.map((p) => [p.kind, p.scientificName])).toEqual([
      ["species", "Ficus elastica"],
      ["species", "Ficus robusta"],
      ["species", "Ficus rubiginosa"],
    ]);
    expect(plan.pills[0].commonName).toBe("Rubber Plant");
  });

  it("leads with the genus when the top three agree and the species score is low", () => {
    const plan = planPills(ECHEVERIA);
    expect(plan.genusLeads).toBe(true);
    expect(plan.lowConfidence).toBe(false);
    expect(plan.pills[0]).toMatchObject({ kind: "genus", scientificName: "Echeveria", score: 0.52, note: "species unsure", rank: 1 });
    expect(plan.pills.slice(1).map((p) => p.scientificName)).toEqual(["Echeveria gigantea", "Echeveria pulidonis"]);
    expect(plan.pills).toHaveLength(3);
  });

  it("sums the species scores for the genus when the API sent no genus row", () => {
    const plan = planPills(ECHEVERIA.filter((c) => c.kind === "species"));
    expect(plan.pills[0]).toMatchObject({ kind: "genus", scientificName: "Echeveria", score: 0.07 });
  });

  it("puts the name field first when scores are tiny and the genera disagree", () => {
    const plan = planPills(UNSURE);
    expect(plan.lowConfidence).toBe(true);
    expect(plan.genusLeads).toBe(false);
    expect(plan.pills).toHaveLength(3);
  });

  it("has nothing to show for a rejected job", () => {
    expect(planPills([])).toEqual({ pills: [], lowConfidence: true, genusLeads: false });
  });
});

describe("percent", () => {
  it("rounds and never shows zero", () => {
    expect(percent(0.671)).toBe("67%");
    expect(percent(0.003)).toBe("1%");
  });
});
