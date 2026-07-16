import {
  boolean,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "../auth-schema";
import { orgs, people } from "./core";

// Opt-in public score-card links (W2-H PR5, ADR 0008). Public resolution is
// a capability-token read (like invites): the plaintext token lives only in
// the share URL; we store its SHA-256 hash. `public_label` is user-chosen
// text shown on the card, decoupled from the §7 pseudonym so a public share
// leaks no PII the user didn't pick. Revocation is a tombstone (revoked_at).
export const shareLinks = pgTable(
  "share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    personId: uuid("person_id").notNull(),
    scoreSlug: text("score_slug").notNull(), // headline metric, e.g. 'fluency'
    publicLabel: text("public_label").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("share_links_org_id_id_uq").on(t.orgId, t.id),
    foreignKey({
      name: "share_links_org_person_fk",
      columns: [t.orgId, t.personId],
      foreignColumns: [people.orgId, people.id],
    }).onDelete("cascade"),
    index("share_links_org_idx").on(t.orgId),
  ],
);

// Anonymized-benchmark contribution consent (W2-H PR5, ADR 0008). One row per
// (org, user); set = upsert on the composite unique. Gates the V3 network's
// anonymized aggregation later (W3-N) — promises nothing now.
export const benchmarkConsent = pgTable(
  "benchmark_consent",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    granted: boolean("granted").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("benchmark_consent_org_id_id_uq").on(t.orgId, t.id),
    unique("benchmark_consent_org_user_uq").on(t.orgId, t.userId),
  ],
);
