import { relations } from "drizzle-orm";
import { account, session, user } from "./auth-schema";

// Drizzle relational-query metadata for Better Auth's own tables. Deliberately
// NOT in auth-schema.ts (kept relation-free, matching the shape Better Auth's
// generator produces) and NOT in src/db/schema.ts (frozen contract, ADR
// required) — this is purely additive query wiring, spread into the schema
// object passed to drizzle() (src/db/client.ts) so `db.query.session`,
// `db.query.user`, and `db.query.account` all have relational metadata.
//
// Why this exists: with drizzleAdapter's `experimental.joins: true` (see
// src/lib/auth.ts), Better Auth's internal adapter
// (better-auth/dist/db/internal-adapter.mjs) issues several `findOne`/
// `findMany` calls with a `join` option instead of two sequential queries —
// most importantly `findSession` (`join: { user: true }`, the getSession hot
// path this change targets) but also credential sign-in's
// `findUserByEmail(email, { includeAccounts: true })` (`join: { account:
// true }`) and OAuth's `findOAuthUser` (`join: { user: true }` on the
// account model). The @better-auth/drizzle-adapter only turns any of these
// into a real SQL join when the corresponding `db.query[model].findFirst({
// with: {...} })` relation exists
// (node_modules/@better-auth/drizzle-adapter/dist/index.mjs ~L336-410) — and
// critically, if `experimental.joins` is on but a relation is MISSING (as
// opposed to the whole model being unqueryable), the adapter does not fall
// back gracefully: `db.query[model]` still exists as a queryable table, so it
// proceeds into `.findFirst({ with: { <missing-relation>: true } })`, which
// throws inside drizzle-orm's query builder ("Cannot read properties of
// undefined (reading 'referencedTable')") instead of logging "Falling back
// to regular query". So enabling `experimental.joins` requires wiring EVERY
// relation pair Better Auth's core adapter can join on, not just the one
// this change is optimizing for.
export const sessionRelations = relations(session, ({ one }) => ({
  // Relation name must be "user" (singular): the adapter's join-name
  // resolution (getQueryModel + the join `includes` map in index.mjs) uses
  // the better-auth model name directly for a one-to-one join, with no
  // plural suffix.
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

// Inverse relations, required by credential sign-in's
// findUserByEmail(email, { includeAccounts: true }) (join: { account: true }
// on the user model, one-to-many -> relation key "accounts", plural per the
// adapter's join-name resolution for a non-unique FK).
export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));
