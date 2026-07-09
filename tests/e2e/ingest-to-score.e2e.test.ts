import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { lowestAttribution } from "../../src/contracts/attribution";
import { metricRecordInputSchema } from "../../src/contracts/metrics";
import { scoreComponentBreakdownSchema } from "../../src/contracts/scores";
import * as authRelations from "../../src/db/auth-relations";
import type { Db } from "../../src/db/client";
import { forOrg, membershipForUser } from "../../src/db/org-scope";
import * as schema from "../../src/db/schema";
import { createAuth } from "../../src/lib/auth";
import type { CredentialEnv } from "../../src/lib/credentials";
import { periodFor } from "../../src/scoring/periods";
import { SAMPLE_PERIOD, sampleClaudeCodeEnvelope } from "../harness/sample-envelopes";
import { resolveConnector, resolveRecompute } from "../harness/seams";

// W1-S cross-workstream E2E (rule 6): the seam-owning run over the frozen
// contracts — signup → connect (encrypted credential) → poll-replay →
// normalize → org-scoped upserts (idempotent re-poll) → score → read back,
// plus the cross-org isolation assertion. Implementations resolve through
// tests/harness/seams.ts, which now points at the merged W1-D connector and
// the merged W1-F engine (via its production `recomputeOrg` entrypoint) —
// this run proves the shippable code, not a harness stand-in.

function testKek(version: string, fill: number): string {
  const bytes = new Uint8Array(32).fill(fill);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `${version}:${btoa(binary)}`;
}
const ENV: CredentialEnv = { CREDENTIAL_KEK_CURRENT: testKek("v1", 7) };

let db: Db;
let orgId: string; // the org under test
let rivalOrgId: string; // must never see the other org's data

beforeAll(async () => {
  // { ...schema, ...authRelations } mirrors src/db/client.ts's fullSchema —
  // see src/db/auth-relations.ts for why db.query.session/user must exist.
  const pgliteDb = drizzle(new PGlite(), { schema: { ...schema, ...authRelations } });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;

  const auth = createAuth(db, {
    BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
    BETTER_AUTH_URL: "http://localhost:3000",
  });
  const founder = await auth.api.signUpEmail({
    body: { name: "Founder", email: "founder@example.com", password: "correct-horse-battery" },
  });
  const rival = await auth.api.signUpEmail({
    body: { name: "Rival", email: "rival@example.com", password: "correct-horse-battery" },
  });
  orgId = (await membershipForUser(db, founder.user.id)).orgId;
  rivalOrgId = (await membershipForUser(db, rival.user.id)).orgId;
});

describe("E2E: signup → connect → ingest → normalize → score", () => {
  let connectionId: string;
  let rawPayloadId: string;
  const subjectIds = new Map<string, string>(); // externalId -> id
  let expectedAttribution: ReturnType<typeof lowestAttribution>;
  let adoptionDefinitionId: string;

  it("connects a vendor: connection row + envelope-encrypted credential", async () => {
    const scoped = forOrg(db, orgId);
    const connection = await scoped.connections.create({
      vendor: "anthropic_console",
      displayName: "Anthropic Console (E2E)",
      authKind: "admin_key",
    });
    connectionId = connection.id;
    await scoped.connections.storeCredential(
      connectionId,
      "api_key",
      "sk-ant-admin01-e2e-not-a-real-key",
      ENV,
    );
    // The poller's only decryption path round-trips.
    const seen = await scoped.connections.withCredential(
      connectionId,
      "api_key",
      ENV,
      async (plaintext) => plaintext,
    );
    expect(seen).toBe("sk-ant-admin01-e2e-not-a-real-key");
  });

  it("ingests a replayed envelope: raw landed, normalize() output contract-valid", async () => {
    const scoped = forOrg(db, orgId);
    const connector = resolveConnector("anthropic_console");
    const envelope = sampleClaudeCodeEnvelope;

    // Land the raw payload first (the replayable 90-day landing zone),
    // exactly as the poller will.
    const rawRow = await scoped.raw.insert({
      connectionId,
      vendor: connector.vendor,
      kind: envelope.kind,
      windowStart: new Date(`${SAMPLE_PERIOD.start}T00:00:00Z`),
      windowEnd: new Date(`${SAMPLE_PERIOD.end}T00:00:00Z`),
      payload: envelope.payload,
    });
    rawPayloadId = rawRow.id;

    const batch = connector.normalize(envelope);

    // Every emitted record must parse against the FROZEN contract shape —
    // this is the drift tripwire any future connector inherits.
    for (const record of batch.records) {
      expect(() => metricRecordInputSchema.parse(record)).not.toThrow();
    }
    // Honesty gap surfaced, never papered over (invariant b).
    expect(batch.gaps.map((g) => g.kind)).toContain("oauth_actors_missing");
    // Console claude_code is daily grain — no fabricated sub-daily signals.
    expect(batch.signals).toEqual([]);

    // NLV-A8 dedup: the duplicated (day1, api-key-1) input rows must SUM
    // (12 + 3 sessions), not produce two records or drop one.
    const apiKeySessions = batch.records.find(
      (r) =>
        r.subject.externalId === "name:api-key-1" &&
        r.metricKey === "sessions" &&
        r.day === SAMPLE_PERIOD.start,
    );
    expect(apiKeySessions?.value).toBe(15);

    expectedAttribution = lowestAttribution(batch.records.map((r) => r.attribution));
    expect(expectedAttribution).toBe("key_project"); // person + key_project mixed

    // Subjects from normalize output (upsert key: connection/kind/external_id).
    const descriptors = [
      ...new Map(
        batch.records.map((r) => [
          `${r.subject.kind}|${r.subject.externalId}`,
          { kind: r.subject.kind, externalId: r.subject.externalId },
        ]),
      ).values(),
    ];
    const subjectRows = await scoped.subjects.upsertMany(connectionId, descriptors);
    for (const row of subjectRows) subjectIds.set(row.externalId, row.id);
    expect(subjectIds.size).toBe(2); // user-1@scrubbed.example + api-key-1

    await scoped.metrics.upsertRecords(
      batch.records.map((r) => ({
        subjectId: subjectIds.get(r.subject.externalId)!,
        metricKey: r.metricKey,
        day: r.day,
        dim: r.dim,
        connectionId,
        value: r.value,
        attribution: r.attribution,
        sourceConnector: "anthropic-console@1",
        rawPayloadId,
      })),
    );

    const activeDays = await scoped.metrics.records({
      metricKey: "active_day",
      from: SAMPLE_PERIOD.start,
      to: SAMPLE_PERIOD.end,
    });
    expect(activeDays).toHaveLength(3); // user-1 ×2 days, api-key-1 ×1 day
  });

  it("re-polling the same window is idempotent (vendors restate; upsert, never insert-once)", async () => {
    const scoped = forOrg(db, orgId);
    const connector = resolveConnector("anthropic_console");
    const batch = connector.normalize(sampleClaudeCodeEnvelope);
    await scoped.metrics.upsertRecords(
      batch.records.map((r) => ({
        subjectId: subjectIds.get(r.subject.externalId)!,
        metricKey: r.metricKey,
        day: r.day,
        dim: r.dim,
        connectionId,
        value: r.value,
        attribution: r.attribution,
        sourceConnector: "anthropic-console@1",
        rawPayloadId,
      })),
    );
    const activeDays = await scoped.metrics.records({
      metricKey: "active_day",
      from: SAMPLE_PERIOD.start,
      to: SAMPLE_PERIOD.end,
    });
    expect(activeDays).toHaveLength(3); // unchanged — overwrite, no duplicates
  });

  it("computes the adoption preset over ingested records with LOWEST-attribution propagation", async () => {
    const scoped = forOrg(db, orgId);

    // Identity + team plumbing so the team-level preset has a valid subject
    // shape (score_results CHECK) — the W2-K seam, exercised minimally.
    const person = await scoped.people.create({
      displayName: "Dev One",
      email: "user-1@scrubbed.example",
    });
    const team = await scoped.teams.create("Pilot Team");
    await scoped.teams.addMember(team.id, person.id);
    await scoped.identities.link(
      subjectIds.get("user-1@scrubbed.example")!,
      person.id,
      "email_match",
    );

    const definitions = await scoped.scores.definitions();
    const adoption = definitions.find(
      (d) => d.slug === "adoption" && d.status === "active" && d.subjectLevel === "team",
    );
    expect(adoption).toBeDefined();
    adoptionDefinitionId = adoption!.id;
    // ADR 0014: `orgId` is a personal org (ensureOrgOfOne signup), which also
    // gets org-scoped PERSON-level clones of the team presets seeded at
    // signup — this is the shipped fix for personal-org dashboards, not
    // something to strip out for this test's benefit.
    const personAdoption = definitions.find(
      (d) => d.slug === "adoption" && d.status === "active" && d.subjectLevel === "person",
    );
    expect(personAdoption).toBeDefined();

    // Run the SAME entrypoint the nightly/post-backfill recompute uses (no
    // hand-rolled evaluation in the test) — this proves the production
    // engine, reading through the org-scoped repository, never raw tables.
    const recompute = resolveRecompute();
    const period = periodFor("rolling_28d", SAMPLE_PERIOD.end);
    const summary = await recompute(db, orgId, { period });
    // 'adoption' and 'fluency' both have SOME real plain-metric data
    // (active_day, feature_used), so both write a result; 'fluency's ratio
    // component (suggestions_accepted/offered — no rows at all) is omitted
    // from its breakdown rather than fabricated as 0. 'efficiency' has only
    // ratio components and neither has both sides present (spend_cents
    // never lands here), so every one of its components is omitted and it
    // evaluates to null — absence of data is never scored as 0, per-component
    // as well as whole-definition (src/scoring/evaluate.ts).
    // Written at BOTH subject levels (team + the ADR-0014 person clone):
    // team-adoption, team-fluency, person-adoption, person-fluency = 4.
    // Dev One is the team's only member and its only exclusive subject, so
    // the person-level rows consume the identical rows the team-level rows
    // do and land on the identical computed value.
    expect(summary.resultsWritten).toBe(4);

    const stored = await scoped.scores.results({ definitionId: adoptionDefinitionId });
    expect(stored).toHaveLength(1);

    // Hand-computed from the sample envelope + the seeded v1 preset, scoped
    // to the team's only member (user-1 — api-key-1 is not a team member,
    // so its rows are correctly excluded by the real recompute path):
    // active_days raw 2 (day1, day2) → (2/20)·100 = 10, ×0.5 = 5
    // tool_coverage raw 1 (claude_code is the only connector wired here;
    //   W2-J's copilot/cursor/openai connectors add further feature_used
    //   dims) → (1/6)·100 = 16.6667, ×0.5 = 8.3334
    expect(stored[0].value).toBeCloseTo(13.3334, 4);
    expect(stored[0].attribution).toBe("person"); // team = user-1 only, all person-level
    // Breakdown survives storage in the frozen shape.
    const breakdown = scoreComponentBreakdownSchema.parse(stored[0].components);
    expect(breakdown.active_days.raw).toBe(2);
    expect(breakdown.tool_coverage.raw).toBe(1);

    // The person-level clone (ADR 0014) computes identically off the same
    // exclusive-subject rows — proving the clone isn't just present, it
    // actually scores.
    const storedPerson = await scoped.scores.results({
      definitionId: personAdoption!.id,
    });
    expect(storedPerson).toHaveLength(1);
    expect(storedPerson[0].value).toBeCloseTo(13.3334, 4);
    expect(storedPerson[0].personId).toBe(person.id);

    // Re-run (nightly + post-backfill recompute) — upsert on the frozen
    // key, still one row, same value.
    await recompute(db, orgId, { period });
    const storedAgain = await scoped.scores.results({ definitionId: adoptionDefinitionId });
    expect(storedAgain).toHaveLength(1);
    expect(storedAgain[0].value).toBeCloseTo(13.3334, 4);
  });

  it("cross-org isolation: the rival org sees none of it", async () => {
    const rival = forOrg(db, rivalOrgId);
    expect(await rival.subjects.list()).toEqual([]);
    expect(
      await rival.metrics.records({
        metricKey: "active_day",
        from: SAMPLE_PERIOD.start,
        to: SAMPLE_PERIOD.end,
      }),
    ).toEqual([]);
    expect(await rival.scores.results({})).toEqual([]);
    expect(await rival.raw.get(rawPayloadId)).toBeUndefined();
    await expect(
      rival.connections.withCredential(connectionId, "api_key", ENV, async (p) => p),
    ).rejects.toThrow();
  });
});
