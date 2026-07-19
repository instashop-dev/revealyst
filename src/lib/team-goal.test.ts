import { describe, expect, it } from "vitest";
import { SCORE_SLUGS } from "./metrics-glossary";
import {
  TEAM_GOAL_METRICS,
  isTeamGoalMetric,
  teamGoalMetricSchema,
} from "./team-goal";

describe("team-goal metric contract", () => {
  it("is exactly the scoring engine's slugs (no drift)", () => {
    expect([...TEAM_GOAL_METRICS]).toEqual([...SCORE_SLUGS]);
  });

  it("accepts every allowed slug", () => {
    for (const slug of TEAM_GOAL_METRICS) {
      expect(isTeamGoalMetric(slug)).toBe(true);
      expect(teamGoalMetricSchema.safeParse(slug).success).toBe(true);
    }
  });

  it("rejects anything outside the closed set (no free-form metric)", () => {
    for (const bad of ["productivity", "custom", "", "ADOPTION", "0"]) {
      expect(isTeamGoalMetric(bad)).toBe(false);
      expect(teamGoalMetricSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("rejects non-string inputs", () => {
    for (const bad of [null, undefined, 3, {}, ["adoption"]]) {
      expect(isTeamGoalMetric(bad)).toBe(false);
    }
  });
});
