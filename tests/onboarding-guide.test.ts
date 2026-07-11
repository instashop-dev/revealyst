import { describe, expect, it } from "vitest";
import {
  buildOnboardingInterim,
  checklistForViewer,
  connectedToolsLabel,
  FIRST_WEEK_CHECKLIST,
  ingestionFacts,
  isUsableConnection,
  LOCAL_CHANNEL_VENDOR,
  SCORE_TIMING_COPY,
  scoreTimingChannel,
  syncedToolCount,
  type ConnectionChannelInput,
} from "../src/lib/onboarding-guide";

const c = (
  vendor: string,
  status: ConnectionChannelInput["status"] = "active",
  lastSuccessAt: ConnectionChannelInput["lastSuccessAt"] = null,
): ConnectionChannelInput => ({ vendor, status, lastSuccessAt });

describe("scoreTimingChannel", () => {
  it("classifies a poll-connector-only org as same_day", () => {
    expect(scoreTimingChannel([c("anthropic_console")])).toBe("same_day");
    expect(scoreTimingChannel([c("openai"), c("cursor")])).toBe("same_day");
    // A pending poll connection is genuinely in-flight (the connect flow
    // kicks off its first poll immediately) — it stays usable.
    expect(scoreTimingChannel([c("openai", "pending")])).toBe("same_day");
  });

  it("classifies a SYNCED local-Agent-only org as overnight", () => {
    // markSynced sets status "active" — that's the "has synced" signal.
    expect(scoreTimingChannel([c(LOCAL_CHANNEL_VENDOR, "active")])).toBe(
      "overnight",
    );
    // lastSuccessAt is the equivalent signal when the caller has it.
    expect(
      scoreTimingChannel([
        c(LOCAL_CHANNEL_VENDOR, "pending", "2026-07-10T00:00:00Z"),
      ]),
    ).toBe("overnight");
  });

  it("classifies a NEVER-SYNCED local-Agent-only org as awaiting_agent (F1)", () => {
    // Token issued / paired, agent never run: connection is pending with no
    // lastSuccessAt — no data is flowing, so no overnight arrival promise.
    expect(scoreTimingChannel([c(LOCAL_CHANNEL_VENDOR, "pending")])).toBe(
      "awaiting_agent",
    );
  });

  it("classifies an org with both channels as mixed (conservative)", () => {
    expect(
      scoreTimingChannel([c("anthropic_console"), c(LOCAL_CHANNEL_VENDOR)]),
    ).toBe("mixed");
    // Mixed also when the agent hasn't synced yet — the mixed copy is
    // future-conditional about the agent, so it holds for both states.
    expect(
      scoreTimingChannel([
        c("anthropic_console"),
        c(LOCAL_CHANNEL_VENDOR, "pending"),
      ]),
    ).toBe("mixed");
  });

  it("returns none when there is no usable connection", () => {
    expect(scoreTimingChannel([])).toBe("none");
    expect(scoreTimingChannel([c("openai", "error")])).toBe("none");
  });

  it("treats paused connections as NOT usable (F2)", () => {
    // Cron dispatch skips paused; agent ingest 403s paused — a paused
    // connection is not ingesting and can't promise scores.
    expect(scoreTimingChannel([c("openai", "paused")])).toBe("none");
    expect(scoreTimingChannel([c(LOCAL_CHANNEL_VENDOR, "paused")])).toBe(
      "none",
    );
    // A paused poll connection must not upgrade a waiting agent to mixed.
    expect(
      scoreTimingChannel([
        c("openai", "paused"),
        c(LOCAL_CHANNEL_VENDOR, "pending"),
      ]),
    ).toBe("awaiting_agent");
    expect(isUsableConnection(c("openai", "paused"))).toBe(false);
    expect(isUsableConnection(c("openai", "pending"))).toBe(true);
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
    // Future-conditional about the agent, so it holds for a not-yet-synced
    // agent too ("after your agent syncs", never "your agent data is in").
    expect(mixed).toContain("after your agent syncs");
    expect(mixed).not.toContain("data is in");
  });

  it("the poll-channel promises are usage-qualified (F5)", () => {
    // An org with zero vendor usage produces no rows and no scores — the
    // "within a day" promise must be conditioned on seeing usage.
    expect(SCORE_TIMING_COPY.same_day.detail).toContain("once we see usage");
    expect(SCORE_TIMING_COPY.mixed.detail).toContain("once we see usage");
  });

  it("never claims agent data 'is in' before the first sync (F1)", () => {
    const awaiting = SCORE_TIMING_COPY.awaiting_agent;
    const all = `${awaiting.headline} ${awaiting.detail}`.toLowerCase();
    expect(all).not.toContain("data is in");
    expect(all).not.toContain("by tomorrow");
    // The arrival claim is conditional on the sync actually happening.
    expect(awaiting.detail).toContain("hasn't synced yet");
    expect(awaiting.detail).toContain("once it syncs");
  });

  it("only poll-bearing channels claim a backfill (F3)", () => {
    expect(SCORE_TIMING_COPY.same_day.connectionNote).toBe(
      "backfill in progress",
    );
    expect(SCORE_TIMING_COPY.mixed.connectionNote).toBe("backfill in progress");
    // The local Agent has no backfill machinery (one-shot client push).
    expect(SCORE_TIMING_COPY.overnight.connectionNote).not.toContain(
      "backfill",
    );
    expect(SCORE_TIMING_COPY.awaiting_agent.connectionNote).not.toContain(
      "backfill",
    );
    expect(SCORE_TIMING_COPY.none.connectionNote).toBe("");
  });
});

describe("syncedToolCount (F4)", () => {
  it("counts distinct usable vendors with a successful sync", () => {
    expect(
      syncedToolCount([
        // Two connections to the same vendor = ONE tool.
        c("openai", "active", "2026-07-09T00:00:00Z"),
        c("openai", "active", "2026-07-10T00:00:00Z"),
        c("anthropic_console", "active", "2026-07-10T00:00:00Z"),
      ]),
    ).toBe(2);
  });

  it("excludes errored, paused, and never-synced connections", () => {
    expect(
      syncedToolCount([
        c("openai", "error", "2026-07-09T00:00:00Z"),
        c("cursor", "paused", "2026-07-09T00:00:00Z"),
        c("anthropic_console", "active", null),
        c(LOCAL_CHANNEL_VENDOR, "pending"),
      ]),
    ).toBe(0);
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

  it("carries the overnight timing for a synced local-only org", () => {
    const interim = buildOnboardingInterim({
      connections: [c(LOCAL_CHANNEL_VENDOR)],
      scoresExist: false,
    });
    expect(interim!.channel).toBe("overnight");
    expect(interim!.timing.detail).toContain("nightly");
  });

  it("carries the awaiting_agent state for a paired-but-never-synced agent (F1)", () => {
    const interim = buildOnboardingInterim({
      connections: [c(LOCAL_CHANNEL_VENDOR, "pending")],
      scoresExist: false,
    });
    expect(interim!.channel).toBe("awaiting_agent");
    expect(interim!.timing.headline).toBe(
      SCORE_TIMING_COPY.awaiting_agent.headline,
    );
  });

  it("returns null for a paused-only org — nothing is ingesting (F2)", () => {
    expect(
      buildOnboardingInterim({
        connections: [c("openai", "paused")],
        scoresExist: false,
      }),
    ).toBeNull();
    // Same for no connections at all.
    expect(
      buildOnboardingInterim({ connections: [], scoresExist: false }),
    ).toBeNull();
  });
});
