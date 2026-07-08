-- Person-level score presets for personal orgs (ADR 0014). Data-only seed —
-- no DDL. PersonalSelfView renders only subjectLevel='person' month scores, but
-- the global presets (0009) are all team-level and a personal org has no teams,
-- so a real personal org never produced any score row. Clone the global team
-- presets at person level as ORG-SCOPED rows for every existing personal org
-- (org_id = the org avoids the (org_id, slug, version) NULLS-NOT-DISTINCT
-- collision a same-slug global person row would hit). Components are cloned
-- verbatim (identical to the fixture personal-presets.json), so the global
-- presets stay the single source of truth. Idempotent: ON CONFLICT DO NOTHING.
-- New personal orgs are seeded at signup by ensureOrgOfOne (same clone).
INSERT INTO "score_definitions"
  ("org_id", "slug", "version", "name", "subject_level", "components", "status")
SELECT o."id", d."slug", d."version", d."name", 'person', d."components", d."status"
FROM "orgs" o
CROSS JOIN "score_definitions" d
WHERE o."kind" = 'personal'
  AND d."org_id" IS NULL
  AND d."subject_level" = 'team'
  AND d."status" = 'active'
ON CONFLICT ("org_id", "slug", "version") DO NOTHING;
