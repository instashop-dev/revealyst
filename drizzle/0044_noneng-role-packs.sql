ALTER TABLE "roles" ADD COLUMN "domain_slug" text;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_domain_slug_domains_slug_fk" FOREIGN KEY ("domain_slug") REFERENCES "public"."domains"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- ─── P8-NE: honest non-engineering role-pack groundwork (ADR 0054) ───
--
-- PROVENANCE (W3-N seed-provenance rule): every row below is a PRODUCT-DEFINED
-- pack definition — authored by the team, NOT invented by an agent from data.
-- It is reference/scaffolding data, seeded in-migration like the engineering
-- graph (0030), roles (0026), and the recommendation catalog (0029).
--
-- HONESTY (invariant b): non-engineering capabilities have NO live telemetry
-- source today. Every connector is a developer tool; CANONICAL_METRICS are all
-- coding families (OQ-003/OQ-004 gate). So the Marketing proof pack below is
-- bound to ZERO signals on purpose — it does NOT and CANNOT render a computed
-- score. The mastery engine's "no evidence → no row" rule (capability-state.ts)
-- makes an unbound capability render the honest not-measured/forming state,
-- never a floored 0 or a fabricated tier.
--
-- GATE ("registered, not yet live" — the Copilot / NLV_PENDING_VENDORS
-- precedent): the non-engineering domains, roles, and capabilities all seed
-- is_active = FALSE. roles.list() and capabilities.list() filter isActive, so
-- these are invisible on every LIVE surface (assignment picker, graph, coaching
-- labels, coverage) — the engineering behavior is byte-identical. They exist as
-- DEFINITIONS: they prove the schema is role-agnostic and give the desktop-agent
-- workstream concrete slugs to bind real signals to. Activation (flip is_active
-- + bind signals + domain-scope the graph read per role — see ADR 0054 §Deferred)
-- is a later desktop-agent PR, gated on a genuine telemetry source existing.
--
-- Idempotent: ON CONFLICT DO NOTHING, so replays (dev-db, tests, deploy) are
-- safe.

-- (1) The role → domain link (P8-NE). Existing engineering roles (0026) predate
-- the column; backfill them to the engineering domain (0030) so person → role →
-- domain → capabilities resolves for every role.
UPDATE "roles" SET "domain_slug" = 'engineering'
  WHERE "slug" IN ('backend','frontend','fullstack','mobile','platform','data','ml','sre')
  AND "domain_slug" IS NULL;--> statement-breakpoint

-- (2) The seven non-engineering domains (TCI §4.2). is_active = FALSE (pending a
-- telemetry source). Sort after Engineering (10).
INSERT INTO "domains" ("slug", "label", "sort", "is_active") VALUES
  ('product', 'Product', 20, false),
  ('marketing', 'Marketing', 30, false),
  ('sales', 'Sales', 40, false),
  ('customer-success', 'Customer success', 50, false),
  ('hr', 'People / HR', 60, false),
  ('finance', 'Finance', 70, false),
  ('operations', 'Operations', 80, false)
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint

-- (3) One assignable role per non-engineering pack, linked to its domain.
-- is_active = FALSE keeps them off the live picker (roles.list()), but
-- role_assignments accepts them structurally (the FK is on roles.slug, not on
-- is_active) — proven by tests/roles.test.ts. Sort after the engineering roles
-- (max 80).
INSERT INTO "roles" ("slug", "label", "domain_slug", "sort", "is_active") VALUES
  ('product', 'Product management', 'product', 110, false),
  ('marketing', 'Marketing', 'marketing', 120, false),
  ('sales', 'Sales', 'sales', 130, false),
  ('customer-success', 'Customer success', 'customer-success', 140, false),
  ('hr', 'People / HR', 'hr', 150, false),
  ('finance', 'Finance', 'finance', 160, false),
  ('operations', 'Operations', 'operations', 170, false)
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint

-- (4) The MARKETING proof pack — seven capability DEFINITIONS (TCI §4.2), under
-- the marketing domain, is_active = FALSE, bound to ZERO signals. Plain-English,
-- beginner-friendly summaries (CLAUDE.md writing rule; a claim surface, so no
-- overclaims). These describe the WORK, not a measurement we can make — the
-- desktop agent (D-DA-5) is the build target that would produce the signals.
-- NO capability_signals rows and NO capability_dependencies rows are added: an
-- unbound capability is exactly the honest not-measured state, by design.
INSERT INTO "capabilities" ("slug", "domain_slug", "version", "label", "summary", "sort", "is_active") VALUES
  ('mkt-audience-research', 'marketing', 1, 'Research your audience with AI', 'Use AI to learn who you are talking to and what they care about, so your work starts from real understanding.', 10, false),
  ('mkt-campaign-ideation', 'marketing', 1, 'Shape campaign ideas with AI', 'Work with AI to come up with and sharpen campaign angles, instead of starting from a blank page.', 20, false),
  ('mkt-copy-development', 'marketing', 1, 'Draft marketing copy with AI', 'Use AI to get first drafts and variations of your copy moving, then make them your own.', 30, false),
  ('mkt-content-repurposing', 'marketing', 1, 'Repurpose content with AI', 'Turn one piece of content into more formats and channels with AI doing the heavy lifting.', 40, false),
  ('mkt-seo-workflows', 'marketing', 1, 'Work through search tasks with AI', 'Bring AI into your search and discoverability work, from planning topics to tidying up pages.', 50, false),
  ('mkt-creative-generation', 'marketing', 1, 'Create visuals with AI', 'Use AI to help produce images and other creative for your campaigns.', 60, false),
  ('mkt-campaign-analysis', 'marketing', 1, 'Make sense of results with AI', 'Use AI to read what happened in a campaign and decide what to try next.', 70, false)
ON CONFLICT ("slug") DO NOTHING;