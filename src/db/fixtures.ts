import { z } from "zod";
import { ATTRIBUTION_LEVELS } from "../contracts/attribution";
import { METRIC_KEYS, type MetricKey } from "../contracts/metrics";
import { scoreDefinitionSchema } from "../contracts/scores";
import type { Db } from "./client";
import { forOrg } from "./org-scope";
import { orgs, scoreDefinitions } from "./schema";

/** Creates an org for fixture/dev seeding — a pre-scope operation (like
 * ensureOrgOfOne), kept here so schema imports stay inside src/db/**. */
export async function createFixtureOrg(
  db: Db,
  name: string,
  kind: "personal" | "team",
) {
  const [org] = await db.insert(orgs).values({ name, kind }).returning();
  return org;
}

// Fixture graphs (rule 2: fixtures over coupling). Entities reference each
// other by local `key` strings — real ids are DB-generated at load time —
// and every insert goes THROUGH the repository layer, so fixtures exercise
// the same org-scoped path production code uses. JSON files live in
// fixtures/metric-records/; the shapes below bind them to the frozen
// contract vocabulary (metric keys, attribution levels, subject kinds), so
// a fixture that drifts from the contracts fails validation in CI.

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const fixtureGraphSchema = z.object({
  connections: z.array(
    z.object({
      key: z.string(),
      vendor: z.string(),
      displayName: z.string(),
      authKind: z.enum([
        "api_key",
        "admin_key",
        "analytics_key",
        "github_app",
        "pat",
        "device_token",
      ]),
    }),
  ),
  people: z.array(
    z.object({
      key: z.string(),
      pseudonym: z.string(),
      displayName: z.string().nullable().default(null),
      email: z.string().nullable().default(null),
    }),
  ),
  teams: z
    .array(z.object({ key: z.string(), name: z.string(), members: z.array(z.string()) }))
    .default([]),
  subjects: z.array(
    z.object({
      key: z.string(),
      connection: z.string(),
      kind: z.enum([
        "person",
        "api_key",
        "service_account",
        "workspace",
        "project",
        "account",
      ]),
      externalId: z.string(),
      email: z.string().nullable().default(null),
      displayName: z.string().nullable().default(null),
    }),
  ),
  identities: z.array(
    z.object({
      subject: z.string(),
      person: z.string(),
      method: z.enum(["email_match", "manual", "vendor_asserted"]),
    }),
  ),
  records: z.array(
    z.object({
      subject: z.string(),
      metricKey: z.enum(METRIC_KEYS as [MetricKey, ...MetricKey[]]),
      day,
      dim: z.string().default(""),
      value: z.number().finite(),
      attribution: z.enum(ATTRIBUTION_LEVELS),
      sourceConnector: z.string(),
    }),
  ),
  signals: z.array(
    z.object({
      subject: z.string(),
      day,
      hours: z.array(z.number().int().min(0)).length(24).nullable(),
      peakConcurrency: z.number().int().min(0).nullable().default(null),
      sourceGranularity: z.enum(["event", "1m", "1h", "none"]),
    }),
  ),
});
export type FixtureGraph = z.infer<typeof fixtureGraphSchema>;

export type LoadedFixture = {
  connections: Record<string, string>;
  people: Record<string, string>;
  teams: Record<string, string>;
  subjects: Record<string, string>;
};

/** Loads a validated fixture graph into an org through the repo layer. */
export async function loadFixture(
  db: Db,
  orgId: string,
  raw: unknown,
): Promise<LoadedFixture> {
  const fixture = fixtureGraphSchema.parse(raw);
  const scoped = forOrg(db, orgId);
  const loaded: LoadedFixture = {
    connections: {},
    people: {},
    teams: {},
    subjects: {},
  };

  for (const c of fixture.connections) {
    const row = await scoped.connections.create({
      vendor: c.vendor,
      displayName: c.displayName,
      authKind: c.authKind,
    });
    loaded.connections[c.key] = row.id;
  }
  for (const p of fixture.people) {
    const row = await scoped.people.create({
      pseudonym: p.pseudonym,
      displayName: p.displayName,
      email: p.email,
    });
    loaded.people[p.key] = row.id;
  }
  for (const t of fixture.teams) {
    const row = await scoped.teams.create(t.name);
    loaded.teams[t.key] = row.id;
    for (const member of t.members) {
      await scoped.teams.addMember(row.id, resolve(loaded.people, member));
    }
  }
  for (const s of fixture.subjects) {
    const [row] = await scoped.subjects.upsertMany(
      resolve(loaded.connections, s.connection),
      [
        {
          kind: s.kind,
          externalId: s.externalId,
          email: s.email,
          displayName: s.displayName,
        },
      ],
    );
    loaded.subjects[s.key] = row.id;
  }
  for (const i of fixture.identities) {
    await scoped.identities.link(
      resolve(loaded.subjects, i.subject),
      resolve(loaded.people, i.person),
      i.method,
    );
  }

  const subjectConnection = new Map(
    fixture.subjects.map((s) => [s.key, s.connection]),
  );
  await scoped.metrics.upsertRecords(
    fixture.records.map((r) => ({
      subjectId: resolve(loaded.subjects, r.subject),
      metricKey: r.metricKey,
      day: r.day,
      dim: r.dim,
      connectionId: resolve(
        loaded.connections,
        subjectConnection.get(r.subject) ?? "",
      ),
      value: r.value,
      attribution: r.attribution,
      sourceConnector: r.sourceConnector,
    })),
  );
  await scoped.metrics.upsertSignals(
    fixture.signals.map((s) => ({
      subjectId: resolve(loaded.subjects, s.subject),
      day: s.day,
      hours: s.hours,
      peakConcurrency: s.peakConcurrency,
      sourceGranularity: s.sourceGranularity,
    })),
  );
  return loaded;
}

function resolve(map: Record<string, string>, key: string): string {
  const id = map[key];
  if (!id) {
    throw new Error(`fixture references unknown key '${key}'`);
  }
  return id;
}

// PLACEHOLDER person-level score definitions for W2-H dev/self-view (rule 2):
// the global presets (drizzle/0009) are team-level, so a personal org — which
// has no teams — needs a person-level definition to render "My AI Fluency".
// These are ORG-SCOPED (loaded into the fixture org only), NEVER global — real
// calibrated person-level definitions are W2-I's deliverable and replace these
// at the W2 integration gate. Kept in db/** (the schema zone) so org-scope.ts's
// frozen public API stays untouched.
export const scoreDefinitionsFixtureSchema = z.object({
  definitions: z.array(scoreDefinitionSchema),
});

/** Inserts org-scoped score definitions into an org through a raw insert
 * (dev/test seeding only — the same seam createFixtureOrg uses). */
export async function loadScoreDefinitions(
  db: Db,
  orgId: string,
  raw: unknown,
): Promise<number> {
  const { definitions } = scoreDefinitionsFixtureSchema.parse(raw);
  for (const def of definitions) {
    await db.insert(scoreDefinitions).values({
      orgId,
      slug: def.slug,
      version: def.version,
      name: def.name,
      subjectLevel: def.subjectLevel,
      components: def.components,
      status: def.status,
    });
  }
  return definitions.length;
}
