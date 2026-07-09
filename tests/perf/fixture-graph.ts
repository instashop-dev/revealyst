// Perf-harness fixture generator (tests/perf/**) — NOT a fixtures/** file,
// so it's exempt from the "changing fixture shapes is an ADR" rule. It
// builds a plain object matching the fixtureGraphSchema shape from
// src/db/fixtures.ts and is loaded through the same loadFixture() seam
// every other test uses, so it exercises the real org-scoped write path.
//
// Sized to approximate a realistic mid-size team workspace: ~25 tracked
// people, 2 connections, usage spread across a 30-day month — big enough
// that dashboard reads aren't trivially empty, small enough to seed fast
// in PGlite.

const DAYS_IN_JUNE = 30;
const dayOf = (day: number) => `2026-06-${String(day).padStart(2, "0")}`;

/** True on ~half the month's days, offset per person so people aren't all
 * active/idle on the same days (spreads trend/heatmap data realistically). */
function isActiveDay(personIndex: number, day: number): boolean {
  return (day + personIndex) % 2 === 0;
}

export function buildTeamFixtureGraph(peopleCount: number) {
  const connections = [
    {
      key: "anthropic",
      vendor: "anthropic_console",
      displayName: "Anthropic Console",
      authKind: "admin_key" as const,
    },
    {
      key: "copilot",
      vendor: "github_copilot",
      displayName: "GitHub Copilot",
      authKind: "github_app" as const,
    },
  ];

  const people = Array.from({ length: peopleCount }, (_, i) => ({
    key: `p${i}`,
    pseudonym: `perf-person-${i}`,
    displayName: null,
    email: `person${i}@fixture.example`,
  }));

  // Three roughly-even teams for the segment-breakdown panel.
  const teamNames = ["Core Engineering", "Platform", "Growth"];
  const teams = teamNames.map((name, teamIdx) => ({
    key: `team${teamIdx}`,
    name,
    members: people
      .filter((_, i) => i % teamNames.length === teamIdx)
      .map((p) => p.key),
  }));

  const subjects: Array<{
    key: string;
    connection: string;
    kind: "person" | "api_key" | "service_account" | "workspace" | "project" | "account";
    externalId: string;
    email?: string | null;
    displayName?: string | null;
  }> = [];
  const identities: Array<{
    subject: string;
    person: string;
    method: "email_match" | "manual" | "vendor_asserted";
  }> = [];

  // Every person has an Anthropic Console seat, identity-resolved.
  for (let i = 0; i < peopleCount; i++) {
    subjects.push({
      key: `console-${i}`,
      connection: "anthropic",
      kind: "person",
      externalId: `person${i}@fixture.example`,
      email: `person${i}@fixture.example`,
    });
    identities.push({
      subject: `console-${i}`,
      person: `p${i}`,
      method: "email_match",
    });
  }
  // A third of the org also has Copilot — exercises multi-tool "tool
  // coverage" and fluency breadth, not just single-connection usage.
  for (let i = 0; i < peopleCount; i += 3) {
    subjects.push({
      key: `copilot-${i}`,
      connection: "copilot",
      kind: "person",
      externalId: `gh-${i}`,
      displayName: `person${i}-gh`,
    });
    identities.push({
      subject: `copilot-${i}`,
      person: `p${i}`,
      method: "vendor_asserted",
    });
  }
  // A shared/service login (account-level attribution) linked to a few
  // people manually — exercises the shared-account-flag path.
  subjects.push({
    key: "shared-console",
    connection: "anthropic",
    kind: "account",
    externalId: "shared-team-login",
  });
  for (const person of ["p0", "p1", "p2"]) {
    identities.push({ subject: "shared-console", person, method: "manual" });
  }
  // A service key with NO identity link — surfaced as unresolved, never
  // billed (invariant b honesty check).
  subjects.push({
    key: "svc-key",
    connection: "anthropic",
    kind: "service_account",
    externalId: "svc-ci-runner",
  });

  const records: Array<{
    subject: string;
    metricKey: string;
    day: string;
    dim?: string;
    value: number;
    attribution: "person" | "key_project" | "account";
    sourceConnector: string;
  }> = [];
  const signals: Array<{
    subject: string;
    day: string;
    hours: number[] | null;
    peakConcurrency: number | null;
    sourceGranularity: "event" | "1m" | "1h" | "none";
  }> = [];

  for (let i = 0; i < peopleCount; i++) {
    let activeDayCount = 0;
    for (let day = 1; day <= DAYS_IN_JUNE; day++) {
      if (!isActiveDay(i, day)) continue;
      activeDayCount++;
      const d = dayOf(day);
      records.push(
        { subject: `console-${i}`, metricKey: "active_day", day: d, value: 1, attribution: "person", sourceConnector: "perf-fixture" },
        { subject: `console-${i}`, metricKey: "tokens_input", day: d, value: 40000 + i * 500 + day * 37, attribution: "person", sourceConnector: "perf-fixture" },
        { subject: `console-${i}`, metricKey: "tokens_output", day: d, value: 6000 + i * 80 + day * 5, attribution: "person", sourceConnector: "perf-fixture" },
        { subject: `console-${i}`, metricKey: "spend_cents", day: d, value: 80 + i * 3 + day, attribution: "person", sourceConnector: "perf-fixture" },
        { subject: `console-${i}`, metricKey: "model_requests", day: d, dim: "model=claude-opus-4", value: 5 + (day % 7), attribution: "person", sourceConnector: "perf-fixture" },
      );
      // Every third active day, add acceptance-ladder data (fluency's
      // "effectiveness" component) — not every day, so honesty rules have
      // a real mix of days-with-data vs days-without to aggregate over.
      if (activeDayCount % 3 === 0) {
        records.push(
          { subject: `console-${i}`, metricKey: "edit_actions_accepted", day: d, value: 10 + (day % 5), attribution: "person", sourceConnector: "perf-fixture" },
          { subject: `console-${i}`, metricKey: "edit_actions_rejected", day: d, value: 1 + (day % 3), attribution: "person", sourceConnector: "perf-fixture" },
        );
      }
      // One feature_used row on the person's first active day of the month.
      if (activeDayCount === 1) {
        records.push({
          subject: `console-${i}`,
          metricKey: "feature_used",
          day: d,
          dim: "feature=chat_panel",
          value: 1,
          attribution: "person",
          sourceConnector: "perf-fixture",
        });
        // A handful of sub-daily signal rows for the activity heatmap.
        if (i < 10) {
          signals.push({
            subject: `console-${i}`,
            day: d,
            hours: Array.from({ length: 24 }, (_, h) => (h >= 9 && h <= 17 ? (h + i) % 6 : 0)),
            peakConcurrency: 1 + (i % 3),
            sourceGranularity: "1h",
          });
        }
      }
    }
  }

  for (let i = 0; i < peopleCount; i += 3) {
    let activeDayCount = 0;
    for (let day = 1; day <= DAYS_IN_JUNE; day++) {
      if (!isActiveDay(i, day)) continue;
      activeDayCount++;
      const d = dayOf(day);
      records.push(
        { subject: `copilot-${i}`, metricKey: "active_day", day: d, value: 1, attribution: "person", sourceConnector: "perf-fixture" },
        { subject: `copilot-${i}`, metricKey: "suggestions_offered", day: d, value: 60 + (day % 20), attribution: "person", sourceConnector: "perf-fixture" },
        { subject: `copilot-${i}`, metricKey: "suggestions_accepted", day: d, value: 20 + (day % 10), attribution: "person", sourceConnector: "perf-fixture" },
        { subject: `copilot-${i}`, metricKey: "lines_added", day: d, value: 50 + (day % 30), attribution: "person", sourceConnector: "perf-fixture" },
      );
      if (activeDayCount === 1) {
        records.push({
          subject: `copilot-${i}`,
          metricKey: "feature_used",
          day: d,
          dim: "feature=completions",
          value: 1,
          attribution: "person",
          sourceConnector: "perf-fixture",
        });
      }
    }
  }

  // Shared account usage — attributed at "account" level (never redistributed
  // to the linked people; invariant b).
  for (let day = 3; day <= DAYS_IN_JUNE; day += 3) {
    const d = dayOf(day);
    records.push(
      { subject: "shared-console", metricKey: "active_day", day: d, value: 1, attribution: "account", sourceConnector: "perf-fixture" },
      { subject: "shared-console", metricKey: "tokens_input", day: d, value: 200000 + day * 100, attribution: "account", sourceConnector: "perf-fixture" },
      { subject: "shared-console", metricKey: "spend_cents", day: d, value: 500 + day, attribution: "account", sourceConnector: "perf-fixture" },
    );
  }

  // Unresolved service-key usage — never billed (surfaced only).
  for (let day = 5; day <= DAYS_IN_JUNE; day += 6) {
    const d = dayOf(day);
    records.push(
      { subject: "svc-key", metricKey: "spend_cents", day: d, value: 120 + day, attribution: "key_project", sourceConnector: "perf-fixture" },
      { subject: "svc-key", metricKey: "tokens_input", day: d, value: 30000 + day * 50, attribution: "key_project", sourceConnector: "perf-fixture" },
    );
  }

  return { connections, people, teams, subjects, identities, records, signals };
}
