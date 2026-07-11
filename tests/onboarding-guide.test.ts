import { describe, expect, it } from "vitest";
import {
  buildOnboardingInterim,
  checklistForViewer,
  connectedToolsLabel,
  FIRST_WEEK_CHECKLIST,
  ingestionFacts,
  LOCAL_CHANNEL_VENDOR,
  SCORE_TIMING_COPY,
  scoreTimingChannel,
  type ConnectionChannelInput,
} from "../src/lib/onboarding-guide";

const c = (
  vendor: string,
  status: ConnectionChannelInput["status"] = "active",
): ConnectionChannelInput => ({ vendor, status });

describe("scoreTimingChannel", () => {
  it("classifies a poll-connector-only org as same_day", () => {
    expect(scoreTimingChannel([c("anthropic_console")])).toBe("same_day");
    expect(scoreTimingChannel([c("openai"), c("cursor")])).toBe("same_day");
  });

  it("classifies a local-Agent-only org as overnight", () => {
    expect(scoreTimingChannel([c(LOCAL_CHANNEL_VENDOR)])).toBe("overnight");
  });

  it("classifies an org with both channels as mixed (conservative)", () => {
    expect(
      scoreTimingChannel([c("anthropic_console"), c(LOCAL_CHANNEL_VENDOR)]),
    ).toBe("mixed");
  });

  it("returns none when there is no usable connection", () => {
    expect(scoreTimingChannel([])).toBe("none");
    expect(scoreTimingChannel([c("openai", "error")])).toBe("none");
  });

  it("ignores errored connections when classifying", () => {
    // An errored poll connector must not upgrade a local-only org to same_day.
    expect(
      scoreTimingChannel([c("openai", "error"), c(LOCAL_CHANNEL_VENDOR)]),
    ).toBe("overnight");
    // A usable poll connector alongside an errored local one is same_day.
    expect(
      scoreTimingChannel([c("openai"), c(LOCAL_CHANNEL_VENDOR, "error")]),
    ).toBe("same_day");
  });
});

describe("SCORE_TIMING_COPY honesty", () => {
  it("never promises same-day/today to a local-only org", () => {
    const overnight = SCORE_TIMING_COPY.overnight.detail.toLowerCase();
    expect(overnight).not.toContain("today");
    expect(overnight).not.toContain("within a day");
    expect(overnight).toContain("nightly");
  });

  it("the mixed message is conservative about the Agent's timing", () => {
    const mixed = SCORE_TIMING_COPY.mixed.detail.toLowerCase();
    // Poll tools land within a day; Agent scores explicitly follow the run.
    expect(mixed).toContain("within a day");
    expect(mixed).toContain("nightly");
  });
});

describe("ingestionFacts", () => {
  it("omits zero/absent counts (no teaser numbers)", () => {
    expect(ingestionFacts(undefined)).toEqual([]);
    expect(
      ingestionFacts({
        activePeople: 0,
        unresolvedSubjects: 0,
        connectionsSynced: 0,
      }),
    ).toEqual([]);
  });

  it("builds only the facts that have a real count, singular/plural aware", () => {
    const facts = ingestionFacts({
      activePeople: 1,
      unresolvedSubjects: 3,
      connectionsSynced: 2,
    });
    const byKey = Object.fromEntries(facts.map((f) => [f.key, f.value]));
    expect(byKey.connectionsSynced).toBe("2 tools");
    expect(byKey.activePeople).toBe("1 person");
    expect(byKey.unresolvedSubjects).toBe("3 subjects");
  });
});

describe("connectedToolsLabel", () => {
  it("labels, dedupes, and joins usable vendors grammatically", () => {
    expect(connectedToolsLabel([c("anthropic_console")])).toBe(
      "Anthropic Console",
    );
    expect(
      connectedToolsLabel([c("anthropic_console"), c(LOCAL_CHANNEL_VENDOR)]),
    ).toContain(" and ");
    // Errored connections are excluded.
    expect(connectedToolsLabel([c("openai", "error")])).toBe("");
  });
});

describe("checklistForViewer", () => {
  it("hides admin-only steps from members but keeps them for admins", () => {
    const admin = checklistForViewer(true);
    const member = checklistForViewer(false);
    expect(admin.length).toBe(FIRST_WEEK_CHECKLIST.length);
    expect(member.length).toBeLessThan(admin.length);
    expect(member.every((s) => !s.adminOnly)).toBe(true);
  });
});

describe("buildOnboardingInterim", () => {
  it("returns null once scores exist (no interim needed)", () => {
    expect(
      buildOnboardingInterim({
        connections: [c("openai")],
        scoresExist: true,
      }),
    ).toBeNull();
  });

  it("composes channel, timing, connected label, and facts from data in hand", () => {
    const interim = buildOnboardingInterim({
      connections: [c("anthropic_console")],
      scoresExist: false,
      ingestionEvidence: { activePeople: 2, connectionsSynced: 1 },
    });
    expect(interim).not.toBeNull();
    expect(interim!.channel).toBe("same_day");
    expect(interim!.timing).toEqual(SCORE_TIMING_COPY.same_day);
    expect(interim!.connectedLabel).toBe("Anthropic Console");
    expect(interim!.facts.map((f) => f.key)).toEqual([
      "connectionsSynced",
      "activePeople",
    ]);
  });

  it("carries the overnight timing for a local-only org", () => {
    const interim = buildOnboardingInterim({
      connections: [c(LOCAL_CHANNEL_VENDOR)],
      scoresExist: false,
    });
    expect(interim!.channel).toBe("overnight");
    expect(interim!.timing.detail).toContain("nightly");
  });
});
