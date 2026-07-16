import type {
  TeamInsightCategory,
  TeamInsightParams,
} from "./team-insights";

// Rendered copy for the aggregate manager insight feed (TCI Phase 2-F, ADR
// 0048). The DB stores NO prose (claim-surface law, W3-N) — a stored insight is
// only a `category` + count-only `params`; every title/body sentence lives HERE
// and is composed at READ time. Plain English for a beginner (product writing
// principle): no jargon, no acronyms, positive-first framing, action-oriented.
// No leaderboard/ranking/XP/streak/points language (a banned-phrasing test
// sweeps this file).

/** A stored insight, as the glossary needs it to render. */
export type RenderableTeamInsight = {
  category: TeamInsightCategory;
  params: TeamInsightParams;
};

export type TeamInsightCopy = { title: string; body: string };

function peopleWord(n: number): string {
  return n === 1 ? "person" : "people";
}

function toolWord(n: number): string {
  return n === 1 ? "tool" : "tools";
}

/**
 * Render a manager insight's plain-English title + body from its stored
 * category and count-only params. `labelFor` resolves a capability slug to its
 * display label (the caller passes the global capability-label map it already
 * holds); an unknown slug falls back to the slug itself. Pure.
 */
export function renderTeamInsight(
  insight: RenderableTeamInsight,
  labelFor: (slug: string) => string,
): TeamInsightCopy {
  const p = insight.params;
  switch (insight.category) {
    case "capability_gap": {
      const cp = p as Extract<TeamInsightParams, { total: number; capabilitySlug: string }>;
      const label = labelFor(cp.capabilitySlug);
      return {
        title: `Room to grow in ${label}`,
        body: `${cp.total} ${peopleWord(cp.total)} are building ${label}, and none have reached a strong level yet. A short shared session could help the whole group move forward.`,
      };
    }
    case "concentration": {
      const cp = p as Extract<TeamInsightParams, { total: number; capabilitySlug: string }>;
      const label = labelFor(cp.capabilitySlug);
      return {
        title: `${label} know-how sits with a few people`,
        body: `Only ${cp.mastered} of ${cp.total} ${peopleWord(cp.total)} have reached a strong level in ${label}. Sharing what they know helps spread it more widely.`,
      };
    }
    case "plateau": {
      const cp = p as Extract<TeamInsightParams, { masteredNow: number; capabilitySlug: string }>;
      const label = labelFor(cp.capabilitySlug);
      return {
        title: `${label} has held steady`,
        body: `Progress in ${label} hasn't moved recently. It could be a good moment to revisit it together.`,
      };
    }
    case "positive_growth": {
      const cp = p as Extract<TeamInsightParams, { masteredNow: number; capabilitySlug: string }>;
      const label = labelFor(cp.capabilitySlug);
      return {
        title: `${label} is growing`,
        body: `More people reached a strong level in ${label} this period — up from ${cp.masteredBefore} to ${cp.masteredNow}. Nice momentum worth keeping.`,
      };
    }
    case "low_adoption": {
      const cp = p as Extract<TeamInsightParams, { active: number; total: number }>;
      return {
        title: "Most of the team is just getting started",
        body: `${cp.active} of ${cp.total} ${peopleWord(cp.total)} have started building AI skills. A shared kickoff could bring more people in.`,
      };
    }
    case "data_incomplete": {
      const cp = p as Extract<TeamInsightParams, { stale: number; connected: number }>;
      return {
        title: "Some tools need a fresh sync",
        body: `${cp.stale} of ${cp.connected} connected ${toolWord(cp.connected)} haven't synced recently, so a few numbers here may be behind. Reconnecting brings them up to date.`,
      };
    }
  }
}

/** Short label for the insight's severity (the card's small tag). Plain words,
 * no jargon; never a color name (styling is the card's job). */
export const TEAM_INSIGHT_SEVERITY_LABEL: Record<string, string> = {
  attention: "Worth a look",
  opportunity: "Opportunity",
  info: "Good news",
};

export const MANAGER_INSIGHTS_COPY = {
  title: "Team insights",
  subtitle: "A few things worth your attention this period — aggregate only, never any one person's data.",
  empty:
    "No insights right now. As your team's activity builds, a short list of things worth noticing will appear here.",
  dismiss: "Dismiss",
  dismissed: "Dismissed",
} as const;
