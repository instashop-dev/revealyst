-- Backfill for required email verification (ADR 0015). Signup verification was
-- never enforced before this release and `email_verified` was never read, so
-- every existing user row is `false`. Enabling emailAndPassword
-- .requireEmailVerification would lock them all out on next sign-in. Mark all
-- pre-existing accounts verified so only NEW signups must confirm their email.
UPDATE "user" SET "email_verified" = true WHERE "email_verified" = false;
