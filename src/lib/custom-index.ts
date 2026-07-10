// Custom Index Builder (W4-U) shared rules — pure constants, zod schemas, and
// helpers with NO db/React imports, so routes, the org-scoped repository, the
// recompute job, and unit tests all enforce the SAME guardrails from one place.
//
// This is UI-over-the-engine, not a DSL (tripwire): a custom index is an
// ordinary `score_definitions` row whose `components` are the frozen,
// zod-validated `scoreComponentsSchema` shapes the presets use — the builder
// only composes that data, it never introduces per-tenant expressions.
//
// Relative imports (not `@/`): this module is imported by tests, matching the
// house style of src/lib/share-card.ts and src/lib/dashboard-read.ts.
import { z } from "zod";
import {
  scoreComponentsSchema,
  SCORE_SUBJECT_LEVELS,
} from "../contracts/scores";

/**
 * Global preset slugs an org must never be able to shadow (§8.5 guardrail 3).
 * The DB uniqueness key is `(org_id, slug, version)` with NULLS NOT DISTINCT,
 * so an org row with slug `adoption` and org_id set does NOT collide with the
 * global `adoption` preset (org_id NULL) — nothing at the DB layer stops the
 * shadow. Reservation is therefore enforced HERE, at the API/schema layer.
 */
export const RESERVED_SLUGS = ["adoption", "fluency", "efficiency"] as const;

/** Every org-authored custom index carries this slug prefix — the single
 * discriminator that separates customs from presets everywhere downstream
 * (recompute inclusion, benchmark/share exclusion, the builder list). */
export const CUSTOM_SLUG_PREFIX = "custom-";

/** §8.5 guardrail 4: per-org cap on *active* custom definitions. Nightly
 * recompute cost scales per active definition, so the cap is on the ACTIVE
 * set — archived versions and superseded versions cost nothing and don't
 * count. Founder-set to the spec's recommended 10. */
export const MAX_ACTIVE_CUSTOM_DEFINITIONS = 10;

/** Bound on components per custom index — keeps a single definition's
 * evaluation cost predictable. The frozen `scoreComponentsSchema` already
 * requires ≥1; this adds the upper bound the builder enforces. */
export const MAX_CUSTOM_COMPONENTS = 8;

/** Custom indexes may only aggregate at team/org level — never `person`
 * (§8.5 guardrail 1: a no-code person-level builder is an admin-built
 * people-scoring surface; the pseudonymization audit predicates don't know
 * about customs, so they'd pass vacuously). */
export const CUSTOM_INDEX_SUBJECT_LEVELS = ["team", "org"] as const;
export type CustomIndexSubjectLevel = (typeof CUSTOM_INDEX_SUBJECT_LEVELS)[number];

// A compile-time guard that our allowed levels are a subset of the frozen
// score subject levels, and deliberately exclude "person".
const _levelsAreSubset: readonly (typeof SCORE_SUBJECT_LEVELS)[number][] =
  CUSTOM_INDEX_SUBJECT_LEVELS;
void _levelsAreSubset;

/** True for a slug produced by this builder (org-authored custom). */
export function isCustomSlug(slug: string): boolean {
  return slug.startsWith(CUSTOM_SLUG_PREFIX);
}

/** True for a global-preset slug an org must not shadow. */
export function isReservedSlug(slug: string): boolean {
  return (RESERVED_SLUGS as readonly string[]).includes(slug);
}

/**
 * Derives a valid custom slug from a display name: lowercased, non-alphanumeric
 * runs collapsed to single hyphens, trimmed, then prefixed with `custom-`.
 * Returns null when the name has no usable characters (caller must reject).
 */
export function slugifyToCustomSlug(name: string): string | null {
  const body = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (body.length === 0) {
    return null;
  }
  return `${CUSTOM_SLUG_PREFIX}${body}`;
}

/**
 * A custom slug: the `custom-` prefix followed by one or more kebab segments.
 * `.refine`d to reject a bare `custom-` and to guarantee no reserved slug can
 * slip through (a reserved slug never starts with the prefix, but the explicit
 * check documents the guardrail and survives any future prefix change).
 */
export const customSlugSchema = z
  .string()
  .regex(
    /^custom-[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "slug must be lowercase kebab-case prefixed with 'custom-'",
  )
  .refine((slug) => !isReservedSlug(slug), {
    message: "slug shadows a reserved preset",
  });

/** The closed subject-level vocabulary for customs (person rejected here). */
export const customSubjectLevelSchema = z.enum(CUSTOM_INDEX_SUBJECT_LEVELS);

/** Components for a custom index: the FROZEN component schema (weights sum to
 * 1, unique keys, each weight in (0,1], normalization ranges) plus the
 * builder's component-count ceiling. Reusing the frozen schema is the whole
 * point — the builder cannot emit anything the engine wouldn't accept. */
export const customComponentsSchema = scoreComponentsSchema.refine(
  (components) => components.length <= MAX_CUSTOM_COMPONENTS,
  { message: `a custom index may have at most ${MAX_CUSTOM_COMPONENTS} components` },
);

/** Publish (create a new version) request body. `slug` is optional: omit it to
 * mint a brand-new index (slug derived from the name), or pass an existing
 * custom slug to publish a new version of it. */
export const customIndexPublishSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: customSlugSchema.optional(),
  subjectLevel: customSubjectLevelSchema,
  components: customComponentsSchema,
});
export type CustomIndexPublishInput = z.infer<typeof customIndexPublishSchema>;

/** Preview (read-only, no persistence) request body. */
export const customIndexPreviewSchema = z.object({
  subjectLevel: customSubjectLevelSchema,
  components: customComponentsSchema,
});
export type CustomIndexPreviewInput = z.infer<typeof customIndexPreviewSchema>;

/** Raised when a publish/unarchive would exceed the active-definition cap. */
export class CustomIndexCapError extends Error {
  constructor(
    message = `at most ${MAX_ACTIVE_CUSTOM_DEFINITIONS} active custom indexes are allowed`,
  ) {
    super(message);
    this.name = "CustomIndexCapError";
  }
}

/** Raised when an archive/unarchive targets a slug the org doesn't own. */
export class CustomIndexNotFoundError extends Error {
  constructor(message = "custom index not found") {
    super(message);
    this.name = "CustomIndexNotFoundError";
  }
}
