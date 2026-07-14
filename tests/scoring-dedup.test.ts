import { describe, expect, it } from "vitest";
import type { ScoreComponent } from "../src/contracts/scores";
import { evaluateDefinition, type EngineRow } from "../src/scoring/evaluate";
import { periodFor } from "../src/scoring/periods";
import { type ParsedDefinition, rowsForSubjects } from "../src/scoring/recompute";

// P0 / W7-0 regression: the dual-source double-count. One person linked to two
// of their OWN connector sources (e.g. anthropic_console admin API +
// claude_code_local agent) lands two metric_records rows for the same
// metric/day/dim — one per subject, because subject_id is part of the natural
// key and `dim` does not encode the source. Additive aggregations (sum /
// avg_per_day) summed both, doubling that person's tokens/spend. Fixed by
// collapsing duplicates within one person's exclusive-subject set (MAX per
// day/dim, lowest attribution survives), opted into ONLY on the person branch.

const PERIOD = periodFor("month", "2026-06-15");

const SUM_TOKENS: ScoreComponent = {
  key: "tokens",
  weight: 1,
  normalization: { min: 0, max: 4000 },
  metric: "tokens_output",
  aggregation: "sum",
};

const definition: ParsedDefinition = {
  id: "test",
  subjectLevel: "person",
  components: [SUM_TOKENS],
};

/** Build byMetric with two subjects, each reporting the SAME (day, dim). */
function twoSourceByMetric(
  aAttribution: EngineRow["attribution"] = "person",
  bAttribution: EngineRow["attribution"] = "person",
): Map<string, Map<string, EngineRow[]>> {
  const row = (subjectId: string, attribution: EngineRow["attribution"]): EngineRow => ({
    subjectId,
    metricKey: "tokens_output",
    day: "2026-06-01",
    dim: "",
    value: 1000,
    attribution,
  });
  const bySubject = new Map<string, EngineRow[]>([
    ["subj-console", [row("subj-console", aAttribution)]],
    ["subj-local", [row("subj-local", bAttribution)]],
  ]);
  return new Map([["tokens_output", bySubject]]);
}

describe("dual-source dedup (P0)", () => {
  const subjects = new Set(["subj-console", "subj-local"]);

  it("collapses same-(day,dim) rows across a person's subjects to MAX, not SUM", () => {
    const byMetric = twoSourceByMetric();
    const collapsed = rowsForSubjects(definition, byMetric, subjects, true);
    const rows = collapsed.get("tokens_output")!;
    expect(rows).toHaveLength(1); // two source rows → one
    expect(rows[0].value).toBe(1000); // MAX, not 2000

    const result = evaluateDefinition(definition.components, collapsed, PERIOD)!;
    // 1000 / 4000 = 25, not the doubled 2000/4000 = 50.
    expect(result.value).toBe(25);
  });

  it("without the flag (team/org path) keeps the raw union — different people must both count", () => {
    const byMetric = twoSourceByMetric();
    const unioned = rowsForSubjects(definition, byMetric, subjects, false);
    const rows = unioned.get("tokens_output")!;
    expect(rows).toHaveLength(2); // both preserved

    const result = evaluateDefinition(definition.components, unioned, PERIOD)!;
    expect(result.value).toBe(50); // 2000/4000 — the intended team union
  });

  it("keeps a genuinely larger value from either source (authoritative superset)", () => {
    const byMetric = twoSourceByMetric();
    // Bump the local subject above the console one.
    byMetric.get("tokens_output")!.get("subj-local")![0].value = 3000;
    const collapsed = rowsForSubjects(definition, byMetric, subjects, true);
    expect(collapsed.get("tokens_output")![0].value).toBe(3000);
  });

  it("the survivor carries the LOWEST attribution of the collapsed group (never laundered up)", () => {
    const byMetric = twoSourceByMetric("person", "account");
    const collapsed = rowsForSubjects(definition, byMetric, subjects, true);
    const result = evaluateDefinition(definition.components, collapsed, PERIOD)!;
    expect(result.attribution).toBe("account"); // degraded input surfaced
  });

  it("leaves distinct-day rows untouched (only same-(day,dim) collapses)", () => {
    const byMetric = twoSourceByMetric();
    byMetric.get("tokens_output")!.get("subj-local")![0].day = "2026-06-02";
    const collapsed = rowsForSubjects(definition, byMetric, subjects, true);
    // Two different days are two real facts — both survive and sum.
    expect(collapsed.get("tokens_output")!).toHaveLength(2);
    const result = evaluateDefinition(definition.components, collapsed, PERIOD)!;
    expect(result.value).toBe(50); // 2000/4000
  });
});
