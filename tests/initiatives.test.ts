import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "../src/db/schema";
import { SCORE_SLUGS } from "../src/lib/metrics-glossary";
import { CAPABILITY_CURRICULUM_ORDER } from "../src/lib/capability-curriculum";
import {
  INITIATIVE_LIBRARY,
  INITIATIVE_TEMPLATE_ORDER,
  isInitiativeTemplate,
} from "../src/lib/initiative-library";

// TMD P2 (ADR 0062). Initiatives are a MANAGEMENT artifact, not a game (R3 /
// Spec V4 §8.4). These guards pin the anti-gamification constraint the same way
// missions do — a schema-shape sweep (no xp/streak/points/… column) and a
// banned-phrasing sweep over the library copy — plus the honesty invariant that
// every template binds to a REAL score/capability slug (never free-form).

const BANNED_TOKENS = [
  "xp",
  "streak",
  "league",
  "leaderboard",
  "points",
  "level up",
  "level-up",
  "badge",
];

describe("initiatives — anti-gamification schema shape", () => {
  it("initiatives + initiative_participants have NO gamification column", () => {
    for (const table of [
      schema.initiatives,
      schema.initiativeParticipants,
      // TMD P3 tail (ADR 0063): the decision log is a record, not a score.
      schema.initiativeDecisions,
    ]) {
      const cols = Object.keys(getTableColumns(table));
      for (const banned of ["xp", "streak", "league", "points", "level", "badge"]) {
        expect(
          cols.some((c) => c.toLowerCase().includes(banned)),
          `column matching "${banned}"`,
        ).toBe(false);
      }
    }
  });
});

describe("initiative library — honesty + anti-gamification", () => {
  it("the order list and the registry keys agree", () => {
    expect([...INITIATIVE_TEMPLATE_ORDER].sort()).toEqual(
      Object.keys(INITIATIVE_LIBRARY).sort(),
    );
    for (const slug of INITIATIVE_TEMPLATE_ORDER) {
      expect(INITIATIVE_LIBRARY[slug].slug).toBe(slug);
    }
  });

  it("every template binds to a REAL score/capability slug (never free-form)", () => {
    for (const slug of INITIATIVE_TEMPLATE_ORDER) {
      const t = INITIATIVE_LIBRARY[slug];
      // At least one target set (invariant b — an initiative must aim at
      // something measurable).
      expect(t.capabilitySlug !== null || t.scoreSlug !== null).toBe(true);
      if (t.scoreSlug !== null) {
        expect(SCORE_SLUGS).toContain(t.scoreSlug);
      }
      if (t.capabilitySlug !== null) {
        expect(CAPABILITY_CURRICULUM_ORDER).toContain(t.capabilitySlug);
      }
    }
  });

  it("isInitiativeTemplate accepts known slugs and rejects the rest", () => {
    for (const slug of INITIATIVE_TEMPLATE_ORDER) {
      expect(isInitiativeTemplate(slug)).toBe(true);
    }
    for (const bad of ["", "not-a-template", null, undefined, 3]) {
      expect(isInitiativeTemplate(bad)).toBe(false);
    }
  });

  it("library copy carries no gamified vocabulary (Spec V4 §8.4)", () => {
    const allCopy = Object.values(INITIATIVE_LIBRARY)
      .flatMap((t) => [t.title, t.summary, t.expectedChange])
      .join(" ");
    // Word-boundary match, not substring: "xp" must not flag the legitimate
    // "expert" / "experiment" (e-xp-ert), and "points" must not flag a future
    // "checkpoints" — we ban the gamification WORDS, not letter runs.
    for (const banned of BANNED_TOKENS) {
      const escaped = banned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b${escaped}\\b`, "i");
      expect(re.test(allCopy), `banned word "${banned}"`).toBe(false);
    }
  });
});
