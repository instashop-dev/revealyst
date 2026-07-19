// W0-C frozen schema — barrel (T5.2, ADR 0041). This file was a 1,749-line
// monolith; it is now a thin re-export of the per-domain modules under
// `src/db/schema/*.ts`. The public surface is byte-for-byte unchanged: every
// table/enum keeps its exported name and shape, so the ~90 importers of
// `@/db/schema` / `../db/schema` and `drizzle.config.ts` (which still points at
// this file — a barrel is a valid single entry) need no change. This is a pure
// move: zero semantic edits, proven by a zero-diff `drizzle-kit generate`.
//
// The re-export ORDER below is load-bearing, not cosmetic. Two constraints:
//   (1) The `auth-schema` re-export MUST come after `core` — `auth-schema`
//       imports `orgs` back from this barrel (a circular import), so `orgs`
//       must initialize before the auth tables are re-exported. Same ordering
//       semantics as the old monolith's trailing `export * from "./auth-schema"`.
//   (2) Composite tenant FKs (`foreignKey({ foreignColumns: [connections.orgId,
//       connections.id] })`) use DIRECT column references evaluated at module
//       load, so a child module's parent must be evaluated first. The order
//       here keeps every composite FK's parent upstream: `core` (orgs/people/
//       teams) → `connections` → `tracking`/`poller` (subjects/connector_runs
//       reference connections) → the rest → `capability-graph` before
//       `missions` (mission_steps references capabilities). Simple
//       `.references(() => x)` FKs are lazy thunks and impose no order.

export * from "./schema/core";
export * from "./schema/connections";
export * from "./schema/tracking";
export * from "./schema/scoring";
export * from "./schema/poller";
export * from "./schema/sharing";
export * from "./schema/billing";
export * from "./schema/audit";
export * from "./schema/digest";
export * from "./schema/recommendations";
export * from "./schema/roles";
export * from "./schema/capability-graph";
export * from "./schema/missions";
// TCI Phase 2-F (ADR 0050): the aggregate manager insight feed. References
// `teams` (core, evaluated first) via a composite tenant FK; no other
// cross-module dependency, so its position here is unconstrained beyond
// "after core".
export * from "./schema/team-insights";
// TMD P1 (ADR 0061): the manager-set team goal / review period. References
// `teams` (core, evaluated first) via a composite tenant FK; no other
// cross-module dependency, so its position here is unconstrained beyond
// "after core" — placed with the other team-scoped manager surfaces.
export * from "./schema/goals";

// Auth tables last: auth-schema imports orgs from this module, so the
// re-export must come after orgs is initialized (circular-import order).
export * from "./auth-schema";
