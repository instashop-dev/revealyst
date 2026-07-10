import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ATTRIBUTION_LEVELS } from "../src/contracts/attribution";
import type { ScoreComponent } from "../src/contracts/scores";
import {
  ATTRIBUTION_GLOSSARY,
  CONCEPT_GLOSSARY,
  describeCalculation,
  HONESTY_GAP_GLOSSARY,
  methodologyAnchor,
  METRIC_REFERENCE,
  resolveGlossaryKey,
  SCORE_GLOSSARY,
  SCORE_SLUGS,
  SHARED_ACCOUNT_REASON_LABELS,
  type HonestyGapKind,
} from "../src/lib/metrics-glossary";
import type { SharedAccountReason } from "../src/lib/shared-account/heuristics";
import { BANNED_PHRASING } from "./helpers/banned-phrasing";

// Completeness tripwires for the plain-English glossary: every live preset
// component, every HonestyGap kind, every attribution level, every
// SharedAccountReason, and the full metric catalog must have a glossary
// entry — so a new preset/vendor/gap kind can't silently ship without copy.

const PRESET_SEED = readFileSync("drizzle/0009_seed-score-presets.sql", "utf8");
// The metric catalog seed spans the original W0-C seed (0007) plus the V1.5
// agentic + credits additions (0022, ADR 0022) — the glossary must mirror the
// FULL catalog, not just the frozen slice.
const CATALOG_SEED =
  readFileSync("drizzle/0007_seed-metric-catalog.sql", "utf8") +
  "\n" +
  readFileSync("drizzle/0022_seed-agentic-and-credits-metrics.sql", "utf8");

// All 6 HonestyGap kinds (src/contracts/connector.ts) — no runtime array is
// exported for this type, so the exhaustive list is hand-mirrored here.
const HONESTY_GAP_KINDS: HonestyGapKind[] = [
  "oauth_actors_missing",
  "telemetry_only_users_in_totals",
  "shared_key_not_person_level",
  "service_accounts_unresolved",
  "sub_daily_unavailable",
  "other",
];

// All SharedAccountReason values (src/lib/shared-account/heuristics.ts) —
// same hand-mirrored-list situation as above.
const SHARED_ACCOUNT_REASONS: SharedAccountReason[] = [
  "round_the_clock",
  "concurrent_usage",
  "volume_exceeds_team_median",
];

describe("SCORE_GLOSSARY ≡ live preset components (drizzle/0009 seed)", () => {
  const rowPattern =
    /\(NULL, '(\w+)', 1, '[^']*', '\w+', '([\s\S]*?)'::jsonb, 'active'\)/g;
  const rows = [...PRESET_SEED.matchAll(rowPattern)];

  it("parses all three preset rows from the seed", () => {
    expect(rows.map((r) => r[1]).sort()).toEqual(["adoption", "efficiency", "fluency"]);
  });

  it("every component key in the seed has a SCORE_GLOSSARY entry", () => {
    for (const [, slug, componentsJson] of rows) {
      const keyPattern = /"key":\s*"([a-zA-Z0-9_]+)"/g;
      const keys = [...componentsJson.matchAll(keyPattern)].map((m) => m[1]);
      expect(keys.length).toBeGreaterThan(0);
      const glossaryScore = SCORE_GLOSSARY[slug as keyof typeof SCORE_GLOSSARY];
      expect(glossaryScore, `no SCORE_GLOSSARY entry for slug '${slug}'`).toBeDefined();
      for (const key of keys) {
        expect(
          glossaryScore.components[key],
          `SCORE_GLOSSARY.${slug}.components is missing '${key}' (found live in the 0009 seed)`,
        ).toBeDefined();
      }
    }
  });

  it("every SCORE_GLOSSARY component key also exists in the live seed (no stale entries)", () => {
    for (const [, slug, componentsJson] of rows) {
      const keyPattern = /"key":\s*"([a-zA-Z0-9_]+)"/g;
      const liveKeys = new Set([...componentsJson.matchAll(keyPattern)].map((m) => m[1]));
      const glossaryScore = SCORE_GLOSSARY[slug as keyof typeof SCORE_GLOSSARY];
      for (const key of Object.keys(glossaryScore.components)) {
        expect(liveKeys.has(key), `SCORE_GLOSSARY.${slug}.components.${key} has no live preset counterpart`).toBe(true);
      }
    }
  });
});

describe("ATTRIBUTION_GLOSSARY covers every AttributionLevel", () => {
  it("has an entry for all 3 levels", () => {
    for (const level of ATTRIBUTION_LEVELS) {
      expect(ATTRIBUTION_GLOSSARY[level], `missing attribution entry for '${level}'`).toBeDefined();
    }
    expect(Object.keys(ATTRIBUTION_GLOSSARY).sort()).toEqual([...ATTRIBUTION_LEVELS].sort());
  });
});

describe("HONESTY_GAP_GLOSSARY covers all 6 HonestyGap kinds", () => {
  it("has an entry for every kind", () => {
    for (const kind of HONESTY_GAP_KINDS) {
      expect(HONESTY_GAP_GLOSSARY[kind], `missing honesty-gap entry for '${kind}'`).toBeDefined();
    }
    expect(Object.keys(HONESTY_GAP_GLOSSARY).sort()).toEqual([...HONESTY_GAP_KINDS].sort());
  });
});

describe("SHARED_ACCOUNT_REASON_LABELS covers every SharedAccountReason", () => {
  it("has a sentence-case label for every reason", () => {
    for (const reason of SHARED_ACCOUNT_REASONS) {
      const label = SHARED_ACCOUNT_REASON_LABELS[reason];
      expect(label, `missing label for '${reason}'`).toBeDefined();
      expect(label[0]).toBe(label[0].toUpperCase());
    }
    expect(Object.keys(SHARED_ACCOUNT_REASON_LABELS).sort()).toEqual(
      [...SHARED_ACCOUNT_REASONS].sort(),
    );
  });
});

describe("METRIC_REFERENCE ≡ metric_catalog seed (drizzle/0007)", () => {
  const rowPattern =
    /\('([a-z_]+)', '[a-z_]+', '([^']*)', '([^']*)', '[a-z_]+', (?:NULL|'[a-z]+')\)/g;
  const rows = [...CATALOG_SEED.matchAll(rowPattern)].map((m) => ({
    key: m[1],
    name: m[2],
    description: m[3],
  }));

  it("parses all 26 catalog rows from the seed (22 W0-C + 4 V1.5 agentic/credits)", () => {
    expect(rows.length).toBe(26);
  });

  it("METRIC_REFERENCE has every seeded key with verbatim name + description", () => {
    for (const row of rows) {
      const entry = METRIC_REFERENCE[row.key];
      expect(entry, `METRIC_REFERENCE missing '${row.key}'`).toBeDefined();
      expect(entry.name).toBe(row.name);
      expect(entry.description).toBe(row.description);
    }
  });

  it("METRIC_REFERENCE has no keys beyond the seed", () => {
    const seedKeys = new Set(rows.map((r) => r.key));
    for (const key of Object.keys(METRIC_REFERENCE)) {
      expect(seedKeys.has(key), `METRIC_REFERENCE has an extra key '${key}' not in the seed`).toBe(true);
    }
  });

  it("every METRIC_REFERENCE entry has a non-empty beginner-friendly 'plain' description", () => {
    for (const [key, entry] of Object.entries(METRIC_REFERENCE)) {
      expect(entry.plain, `METRIC_REFERENCE.${key}.plain is missing`).toBeTruthy();
      expect(entry.plain.trim().length, `METRIC_REFERENCE.${key}.plain is empty`).toBeGreaterThan(0);
    }
  });
});

// The two ad-hoc anchor ids the methodology page mints directly (not sourced
// from any glossary map) — "When data is incomplete" and "Metrics
// reference" section headings (src/app/(app)/methodology/page.tsx).
const PAGE_ONLY_ANCHOR_KEYS = ["honestyGaps", "metricsReference"];

describe("methodologyAnchor", () => {
  it("is unique across every score, component, concept, metric, and page-only key", () => {
    const keys: string[] = [
      ...SCORE_SLUGS,
      ...SCORE_SLUGS.flatMap((slug) => Object.keys(SCORE_GLOSSARY[slug].components)),
      ...Object.keys(CONCEPT_GLOSSARY),
      ...Object.keys(METRIC_REFERENCE),
      ...PAGE_ONLY_ANCHOR_KEYS,
    ];
    const anchors = keys.map(methodologyAnchor);
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  it("produces stable kebab-case ids", () => {
    expect(methodologyAnchor("tool_coverage")).toBe("tool-coverage");
    expect(methodologyAnchor("sharedAccounts")).toBe("shared-accounts");
    expect(methodologyAnchor("adoption")).toBe("adoption");
  });
});

describe("banned-phrasing guard (invariant b: no invented benchmarks)", () => {
  function collectInterpretStrings(): { where: string; text: string }[] {
    const strings: { where: string; text: string }[] = [];
    for (const slug of SCORE_SLUGS) {
      const score = SCORE_GLOSSARY[slug];
      strings.push({ where: `SCORE_GLOSSARY.${slug}.howToInterpret`, text: score.howToInterpret });
      for (const tone of ["low", "building", "strong"] as const) {
        strings.push({
          where: `SCORE_GLOSSARY.${slug}.interpretBands.${tone}`,
          text: score.interpretBands[tone],
        });
      }
      for (const [key, component] of Object.entries(score.components)) {
        strings.push({
          where: `SCORE_GLOSSARY.${slug}.components.${key}.howToInterpret`,
          text: component.howToInterpret,
        });
      }
    }
    for (const [key, concept] of Object.entries(CONCEPT_GLOSSARY)) {
      strings.push({ where: `CONCEPT_GLOSSARY.${key}.howToInterpret`, text: concept.howToInterpret });
    }
    return strings;
  }

  it("no howToInterpret/interpretBands string states a benchmark/threshold as fact", () => {
    for (const { where, text } of collectInterpretStrings()) {
      expect(BANNED_PHRASING.test(text), `${where} matches banned phrasing: "${text}"`).toBe(false);
    }
  });
});

describe("SCORE_GLOSSARY.interpretBands completeness", () => {
  it("every score has non-empty low/building/strong band guidance", () => {
    for (const slug of SCORE_SLUGS) {
      const bands = SCORE_GLOSSARY[slug].interpretBands;
      for (const tone of ["low", "building", "strong"] as const) {
        expect(bands[tone], `SCORE_GLOSSARY.${slug}.interpretBands.${tone} is missing`).toBeTruthy();
      }
    }
  });
});

describe("resolveGlossaryKey / relatedKeys resolvability", () => {
  // The known-anchors set: every key relatedKeys is allowed to point at —
  // score slugs, every score's component keys, concept keys, honesty-gap
  // kinds, and shared-account reasons (mirrors what the methodology page
  // actually renders an anchor id for).
  const knownAnchorKeys = new Set<string>([
    ...SCORE_SLUGS,
    ...SCORE_SLUGS.flatMap((slug) => Object.keys(SCORE_GLOSSARY[slug].components)),
    ...Object.keys(CONCEPT_GLOSSARY),
    ...HONESTY_GAP_KINDS,
    ...SHARED_ACCOUNT_REASONS,
  ]);

  function collectRelatedKeys(): { where: string; relatedKeys: string[] }[] {
    const entries: { where: string; relatedKeys: string[] }[] = [];
    for (const slug of SCORE_SLUGS) {
      const score = SCORE_GLOSSARY[slug];
      entries.push({ where: `SCORE_GLOSSARY.${slug}`, relatedKeys: score.relatedKeys ?? [] });
      for (const [key, component] of Object.entries(score.components)) {
        entries.push({
          where: `SCORE_GLOSSARY.${slug}.components.${key}`,
          relatedKeys: component.relatedKeys ?? [],
        });
      }
    }
    for (const [key, concept] of Object.entries(CONCEPT_GLOSSARY)) {
      entries.push({ where: `CONCEPT_GLOSSARY.${key}`, relatedKeys: concept.relatedKeys ?? [] });
    }
    return entries;
  }

  it("every relatedKeys member is in the known-anchors set", () => {
    for (const { where, relatedKeys } of collectRelatedKeys()) {
      for (const key of relatedKeys) {
        expect(knownAnchorKeys.has(key), `${where}.relatedKeys has unknown key '${key}'`).toBe(true);
      }
    }
  });

  it("every relatedKeys member resolves via resolveGlossaryKey (renders a real 'See also' link)", () => {
    for (const { where, relatedKeys } of collectRelatedKeys()) {
      for (const key of relatedKeys) {
        expect(resolveGlossaryKey(key), `${where}.relatedKeys '${key}' does not resolve`).toBeDefined();
      }
    }
  });
});

describe("describeCalculation", () => {
  it("mentions both metric names for a ratio component", () => {
    const ratio: ScoreComponent = {
      key: "effectiveness",
      ratio: {
        numerator: { metric: "suggestions_accepted", aggregation: "sum" },
        denominator: { metric: "suggestions_offered", aggregation: "sum" },
      },
      weight: 0.34,
      normalization: { min: 0, max: 0.5 },
    };
    const { simple, detailed } = describeCalculation(ratio);
    expect(simple).toMatch(/Suggestions accepted/);
    expect(simple).toMatch(/Suggestions offered/);
    expect(detailed).toMatch(/Suggestions accepted/);
    expect(detailed).toMatch(/Suggestions offered/);
  });

  it("mentions the normalization max for a plain component", () => {
    const plain: ScoreComponent = {
      key: "active_days",
      metric: "active_day",
      aggregation: "active_days",
      weight: 0.5,
      normalization: { min: 0, max: 20 },
    };
    const { simple, detailed } = describeCalculation(plain);
    expect(simple).toContain("20");
    expect(detailed).toContain("20");
  });

  it("never hard-codes numbers — reflects the component's own weight/min/max", () => {
    const plain: ScoreComponent = {
      key: "tool_coverage",
      metric: "feature_used",
      aggregation: "distinct_dims",
      weight: 0.5,
      normalization: { min: 0, max: 6 },
    };
    const { simple } = describeCalculation(plain);
    expect(simple).toContain("6");
    expect(simple).not.toContain("20");
  });
});
