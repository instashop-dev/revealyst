import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import {
  createFixtureOrg,
  loadFixture,
  type LoadedFixture,
} from "../src/db/fixtures";
import { forOrg } from "../src/db/org-scope";
import * as schema from "../src/db/schema";
import {
  computeCapabilityStates,
  type CapabilityGraphInput,
} from "../src/scoring/capability-state";
import { recomputeCapabilityState } from "../src/scoring/recompute-capability-state";

// W7-8: the measured tier. ≥2 corroborating OTel markers (real active time +
// real accept/reject — keys no admin-API connector emits) upgrade a capability
// from `directional` to `measured` (ADR 0039). Pure-engine rule + an end-to-end
// pass through the reducer from marker metric_records.

describe("measured-tier rule (pure engine)", () => {
  const GRAPH: CapabilityGraphInput = {
    capabilities: [{ slug: "cap", sort: 10 }],
    dependencies: [],
    signals: [
      { capabilitySlug: "cap", metricKey: "otel_active_time", componentKey: null },
      { capabilitySlug: "cap", metricKey: "otel_edit_accepted", componentKey: null },
    ],
  };
  const evidence = (metricEvidence: Map<string, { evidenceDays: number; count: number; lastDay: string | null }>) => ({
    componentValues: new Map<string, number>(),
    metricEvidence,
    sourceCount: 2,
  });

  it("≥2 bound markers with evidence → measured", () => {
    const states = computeCapabilityStates(
      GRAPH,
      evidence(
        new Map([
          ["otel_active_time", { evidenceDays: 4, count: 10, lastDay: "2026-06-15" }],
          ["otel_edit_accepted", { evidenceDays: 3, count: 8, lastDay: "2026-06-15" }],
        ]),
      ),
      "2026-06-15",
    );
    expect(states[0].confidenceTier).toBe("measured");
  });

  it("only ONE marker with evidence → stays directional", () => {
    const states = computeCapabilityStates(
      GRAPH,
      evidence(
        new Map([["otel_active_time", { evidenceDays: 4, count: 10, lastDay: "2026-06-15" }]]),
      ),
      "2026-06-15",
    );
    expect(states[0].confidenceTier).toBe("directional");
  });
});

describe("measured tier end-to-end (marker metric_records → measured)", () => {
  const teamFixture = JSON.parse(
    readFileSync("fixtures/metric-records/team-30d.json", "utf8"),
  );
  const AS_OF = "2026-06-15";
  let db: Db;
  let orgA: string;
  let A: LoadedFixture;

  beforeAll(async () => {
    const pgliteDb = drizzle(new PGlite(), { schema });
    await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
    db = pgliteDb as unknown as Db;
    orgA = (await createFixtureOrg(db, "otel-a", "team")).id;
    A = await loadFixture(db, orgA, teamFixture);
    // Seed two OTel markers on alice's EXCLUSIVE subject — effective-prompting
    // binds both otel_edit_accepted + otel_active_time (mig 0034).
    const scoped = forOrg(db, orgA);
    await scoped.metrics.upsertRecords([
      {
        subjectId: A.subjects["alice-console"],
        metricKey: "otel_active_time",
        day: "2026-06-10",
        dim: "",
        connectionId: A.connections.anthropic,
        value: 120,
        attribution: "person",
        sourceConnector: "claude-code-otel@1",
      },
      {
        subjectId: A.subjects["alice-console"],
        metricKey: "otel_edit_accepted",
        day: "2026-06-10",
        dim: "",
        connectionId: A.connections.anthropic,
        value: 6,
        attribution: "person",
        sourceConnector: "claude-code-otel@1",
      },
    ]);
  });

  it("alice's effective-prompting renders MEASURED from the two markers", async () => {
    await recomputeCapabilityState(db, orgA, { asOfDay: AS_OF });
    const alice = await forOrg(db, orgA).mastery.forPerson(A.people.alice);
    const effective = alice.find((s) => s.capabilitySlug === "effective-prompting");
    expect(effective, "effective-prompting present").toBeDefined();
    expect(effective!.confidenceTier).toBe("measured");
    // Capabilities WITHOUT ≥2 markers stay directional (e.g. foundations).
    const foundations = alice.find((s) => s.capabilitySlug === "ai-coding-foundations");
    if (foundations) expect(foundations.confidenceTier).toBe("directional");
  });
});
