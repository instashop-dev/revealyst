import type {
  Connector,
  ConnectorContext,
  DateWindow,
  RawPayloadEnvelope,
  SubjectDescriptor,
} from "../../contracts/connector";
import type { RegisteredConnector } from "../registry";
import { SCOPE_CLAIMS } from "../scope-claims";
import {
  callSpacing,
  CALL_SPACING_MS,
  checkReportsAccess,
  type CopilotScope,
  fetchPersonalAiCreditUsage,
  fetchUsersDaily,
  fetchUserTeams,
} from "./client";
import {
  type FetchFn,
  type GithubAppCredential,
  mintInstallationToken,
  parseAppCredential,
} from "./github-app";
import { normalizeCopilot } from "./normalize";
import {
  type CopilotAiCreditUsageItem,
  type CopilotRaw,
  ENVELOPE_KINDS,
} from "./types";

// GitHub Copilot connector (W4-T). Two modes on connection.config.mode:
//   - "org" / "enterprise" (default): GitHub App installation-token auth
//     against the usage-metrics reports API. Person-level per-user daily
//     records; team membership from the users×user-teams join lands on the
//     subject meta. No sub-daily grain (facts §1). authKind = "github_app";
//     the App auth material (appId/installationId/privateKeyPem JSON) is the
//     `github_app_private_key` credential row.
//   - "personal": a personal-plan user's own AI-credit spend context read
//     with their PAT (authKind "pat"). Spend context ONLY — usage metrics are
//     org-only (facts §6a.2). config: { username }.
//
// The private key never leaves ctx.credential; installation tokens are minted
// fresh per poll and never persisted.

type Config = {
  mode?: "org" | "enterprise" | "personal";
  org?: string;
  enterprise?: string;
  username?: string;
  appId?: string;
  installationId?: string;
  fetchImpl?: unknown;
};

function fetchFrom(ctx: ConnectorContext): FetchFn {
  const injected = (ctx.connection.config as Config).fetchImpl;
  return typeof injected === "function" ? (injected as FetchFn) : fetch;
}

function configOf(ctx: ConnectorContext): Config {
  return ctx.connection.config as Config;
}

function scopeOf(config: Config): CopilotScope {
  if (config.mode === "enterprise") {
    if (!config.enterprise) {
      throw new Error("github_copilot: enterprise mode requires config.enterprise");
    }
    return { kind: "enterprise", slug: config.enterprise };
  }
  if (!config.org) {
    throw new Error("github_copilot: org mode requires config.org");
  }
  return { kind: "org", slug: config.org };
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function eachDay(window: DateWindow): string[] {
  const days: string[] = [];
  const d = new Date(`${window.start}T00:00:00Z`);
  const end = new Date(`${window.end}T00:00:00Z`);
  while (d <= end) {
    days.push(isoDay(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

/** A recently-finalized day (D-4, safely past the ≤3-day finalization) for
 * auth probes + team discovery. */
function finalizedDay(now: Date): string {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() - 4);
  return isoDay(d);
}

/** App auth material for org/enterprise mode; throws (permanently) in
 * personal mode where the credential is a PAT, not an App blob. */
function appCredentialOf(ctx: ConnectorContext): GithubAppCredential {
  return parseAppCredential(ctx.credential);
}

export const copilotConnector: Connector<CopilotRaw> = {
  vendor: "github_copilot",
  capabilities: {
    subDaily: "none", // event-level API sunset — daily grain only (facts §1)
    attributionCeiling: "person",
    // Data finalizes ≤3 full UTC days and past days are restated — re-poll a
    // 3-day trailing window so restatements land via the upsert key (§10.1).
    restatementWindowDays: 3,
    // Reports: rolling ~1 year (history floor 2025-10-10). The dispatcher
    // clamps backfill to this depth.
    maxBackfillDays: 365,
  },

  async validateAuth(ctx) {
    const config = configOf(ctx);
    const fetchFn = fetchFrom(ctx);
    if (config.mode === "personal") {
      if (!config.username) {
        return { ok: false, reason: "personal mode requires config.username" };
      }
      // The PAT reads the user's own billing usage — probe the current month.
      const now = ctx.now();
      try {
        await fetchPersonalAiCreditUsage(
          ctx.credential,
          config.username,
          now.getUTCFullYear(),
          now.getUTCMonth() + 1,
          fetchFn,
        );
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    }
    let scope: CopilotScope;
    let cred: GithubAppCredential;
    try {
      scope = scopeOf(config);
      cred = appCredentialOf(ctx);
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    let token: string;
    try {
      token = (await mintInstallationToken(cred, ctx.now(), fetchFn)).token;
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    return checkReportsAccess(token, scope, finalizedDay(ctx.now()), fetchFn);
  },

  async discover(ctx) {
    const config = configOf(ctx);
    const fetchFn = fetchFrom(ctx);
    if (config.mode === "personal") {
      if (!config.username) return [];
      return [
        {
          kind: "person",
          externalId: `login:${config.username.toLowerCase()}`,
          displayName: config.username,
          meta: { login: config.username, mode: "personal" },
        },
      ];
    }

    const scope = scopeOf(config);
    const token = (await mintInstallationToken(appCredentialOf(ctx), ctx.now(), fetchFn)).token;
    // The users×user-teams join: latest-day memberships attach to each person
    // subject's meta for team-level segmentation downstream. Membership is
    // fairly stable, so the finalized day is representative; a user with no
    // team (e.g. a <5-seat suppressed team) still gets a subject from poll's
    // records via the framework's remember/upsert path.
    const teamRows = await fetchUserTeams(token, scope, finalizedDay(ctx.now()), fetchFn);
    const byUser = new Map<string, SubjectDescriptor>();
    for (const row of teamRows) {
      if (row.user_id === undefined || row.user_id === null) continue;
      const key = `user:${row.user_id}`;
      let subject = byUser.get(key);
      if (!subject) {
        subject = {
          kind: "person",
          externalId: key,
          // Metrics API exposes no email — login is the identity handle.
          email: null,
          displayName: row.user_login,
          meta: { login: row.user_login, teams: [] as string[] },
        };
        byUser.set(key, subject);
      }
      if (row.team_slug) {
        (subject.meta!.teams as string[]).push(row.team_slug);
      }
    }
    return [...byUser.values()];
  },

  async poll(ctx, window: DateWindow) {
    const config = configOf(ctx);
    const fetchFn = fetchFrom(ctx);
    const envelopes: RawPayloadEnvelope<CopilotRaw>[] = [];

    if (config.mode === "personal") {
      if (!config.username) {
        throw new Error("github_copilot: personal mode requires config.username");
      }
      // One call per (year, month) the window touches; filter items to the
      // window so the framework's delete-then-upsert (scoped to window) stays
      // consistent — never upsert a day outside the polled window.
      for (const { year, month } of monthsIn(window)) {
        const usage = await fetchPersonalAiCreditUsage(
          ctx.credential,
          config.username,
          year,
          month,
          fetchFn,
        );
        const items = (usage.usageItems ?? []).filter((it: CopilotAiCreditUsageItem) => {
          const day = it.date ?? it.day;
          return day && day >= window.start && day <= window.end;
        });
        envelopes.push({
          kind: ENVELOPE_KINDS.personalSpend,
          window,
          payload: { surface: "personal_spend", username: config.username, usage: { usageItems: items } },
        });
        await callSpacing(CALL_SPACING_MS);
      }
      ctx.log(`copilot(personal): ${envelopes.length} spend envelopes for ${window.start}..${window.end}`);
      return envelopes;
    }

    const scope = scopeOf(config);
    const token = (await mintInstallationToken(appCredentialOf(ctx), ctx.now(), fetchFn)).token;
    // One users-1-day report per UTC day (the endpoints have no since/until;
    // backfill iterates 1-day endpoints — facts §1). Each lands as ONE
    // day-scoped envelope so normalize sums that day in a single pass.
    for (const day of eachDay(window)) {
      const records = await fetchUsersDaily(token, scope, day, fetchFn);
      envelopes.push({
        kind: ENVELOPE_KINDS.usersDaily,
        window: { start: day, end: day },
        payload: { surface: "users_daily", day, records },
      });
      await callSpacing(CALL_SPACING_MS);
    }
    ctx.log(
      `copilot: ${envelopes.length} day-reports for ${window.start}..${window.end} (${scope.kind} ${scope.slug})`,
    );
    return envelopes;
  },

  normalize: normalizeCopilot,
};

/** The distinct (year, month) pairs a day window spans. */
function monthsIn(window: DateWindow): Array<{ year: number; month: number }> {
  const out: Array<{ year: number; month: number }> = [];
  const seen = new Set<string>();
  const d = new Date(`${window.start}T00:00:00Z`);
  const end = new Date(`${window.end}T00:00:00Z`);
  while (d <= end) {
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export const copilotEntry: RegisteredConnector = {
  connector: copilotConnector as Connector,
  scopeClaims: SCOPE_CLAIMS.github_copilot,
  sourceConnector: "github-copilot@1",
  // Per covered day: 1 users-1-day listing + a few NDJSON file downloads +
  // headroom ≈ 6 (facts NLV-C10: file count/sharding unverified).
  maxCallsPerDay: 6,
  // Daily grain; credits land once/day. Poll spacing well inside GitHub's
  // pools — 6h keeps churn low while catching the ≤3-day restatements.
  pollIntervalMinutes: 360,
};
