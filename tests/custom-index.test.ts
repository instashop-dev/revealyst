import { describe, expect, it } from "vitest";
import {
  CUSTOM_SLUG_PREFIX,
  customComponentsSchema,
  customIndexPublishSchema,
  customSlugSchema,
  customSubjectLevelSchema,
  isCustomSlug,
  isReservedSlug,
  MAX_CUSTOM_COMPONENTS,
  RESERVED_SLUGS,
  slugifyToCustomSlug,
} from "../src/lib/custom-index";

// Guardrail unit suite for the pure Custom Index Builder rules (§8.5): slug
// reservation/prefix (guardrail 3), person-level rejection (guardrail 1), and
// weights-sum-to-1 via the frozen component schema.

const metricComponent = (key: string, weight: number) => ({
  key,
  metric: "active_day",
  aggregation: "active_days",
  weight,
  normalization: { min: 0, max: 20 },
});

describe("slug reservation + prefixing (guardrail 3)", () => {
  it("accepts a well-formed custom slug", () => {
    expect(customSlugSchema.safeParse("custom-agentic-adoption").success).toBe(
      true,
    );
  });

  it("rejects a bare prefix and non-prefixed slugs", () => {
    expect(customSlugSchema.safeParse("custom-").success).toBe(false);
    expect(customSlugSchema.safeParse("velocity").success).toBe(false);
    expect(customSlugSchema.safeParse("Custom-Velocity").success).toBe(false);
    expect(customSlugSchema.safeParse("custom-Velocity").success).toBe(false);
  });

  it("rejects every reserved preset slug", () => {
    for (const reserved of RESERVED_SLUGS) {
      expect(isReservedSlug(reserved)).toBe(true);
      expect(customSlugSchema.safeParse(reserved).success).toBe(false);
      // Even a preset name is not custom (no prefix).
      expect(isCustomSlug(reserved)).toBe(false);
    }
  });

  it("isCustomSlug keys strictly on the prefix", () => {
    expect(isCustomSlug(`${CUSTOM_SLUG_PREFIX}x`)).toBe(true);
    expect(isCustomSlug("adoption")).toBe(false);
  });

  it("slugifies a name into a valid custom slug, or null for empties", () => {
    expect(slugifyToCustomSlug("Agentic Adoption!")).toBe(
      "custom-agentic-adoption",
    );
    expect(slugifyToCustomSlug("  Weird   spacing  ")).toBe(
      "custom-weird-spacing",
    );
    expect(slugifyToCustomSlug("!!!")).toBeNull();
    expect(slugifyToCustomSlug("   ")).toBeNull();
    // The derived slug always passes the schema.
    const slug = slugifyToCustomSlug("Model Mix Depth 2");
    expect(slug && customSlugSchema.safeParse(slug).success).toBe(true);
  });
});

describe("subject-level restriction (guardrail 1)", () => {
  it("admits only team and org, never person", () => {
    expect(customSubjectLevelSchema.safeParse("team").success).toBe(true);
    expect(customSubjectLevelSchema.safeParse("org").success).toBe(true);
    expect(customSubjectLevelSchema.safeParse("person").success).toBe(false);
  });

  it("rejects a person-level publish body outright", () => {
    const result = customIndexPublishSchema.safeParse({
      name: "People index",
      subjectLevel: "person",
      components: [metricComponent("a", 1)],
    });
    expect(result.success).toBe(false);
  });
});

describe("weights + component bounds", () => {
  it("requires component weights to sum to 1", () => {
    expect(
      customComponentsSchema.safeParse([
        metricComponent("a", 0.5),
        metricComponent("b", 0.4),
      ]).success,
    ).toBe(false);
    expect(
      customComponentsSchema.safeParse([
        metricComponent("a", 0.5),
        metricComponent("b", 0.5),
      ]).success,
    ).toBe(true);
  });

  it("rejects more than the component ceiling", () => {
    const many = Array.from({ length: MAX_CUSTOM_COMPONENTS + 1 }, (_, i) =>
      metricComponent(`c${i}`, 1 / (MAX_CUSTOM_COMPONENTS + 1)),
    );
    expect(customComponentsSchema.safeParse(many).success).toBe(false);
  });

  it("accepts a valid single-component publish body", () => {
    const result = customIndexPublishSchema.safeParse({
      name: "Agentic Adoption",
      slug: "custom-agentic-adoption",
      subjectLevel: "team",
      components: [metricComponent("depth", 1)],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a publish body whose slug shadows a preset", () => {
    const result = customIndexPublishSchema.safeParse({
      name: "Fake adoption",
      slug: "adoption",
      subjectLevel: "team",
      components: [metricComponent("a", 1)],
    });
    expect(result.success).toBe(false);
  });
});
