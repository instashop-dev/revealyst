// W3-O KEK-rotation driver: sweeps every org and rewraps each stored
// credential's DEK under CREDENTIAL_KEK_CURRENT (rotation = DEK rewrap only
// — data ciphertext is never touched; see src/lib/credentials.ts and
// docs/ops-runbooks.md § Secrets / KEK rotation for the full procedure).
//
// Run manually mid-rotation, while BOTH KEKs are configured:
//
//   DATABASE_URL=<neon-conn> \
//   CREDENTIAL_KEK_CURRENT="v2:<base64>" \
//   CREDENTIAL_KEK_PREVIOUS="v1:<base64>" \
//   npx tsx scripts/rotate-kek.ts [--dry-run]
//
// Idempotent and resumable: rows already at the current KEK version are
// skipped (rewrapCredentials compares kekVersion), so a crash mid-sweep is
// re-run safely. Exits non-zero if any org fails, listing the stragglers —
// do NOT drop CREDENTIAL_KEK_PREVIOUS until a clean all-orgs pass prints
// "rotation complete".
import { createDb } from "../src/db/client";
import { countCredentialsNeedingRewrap, listOrgIds } from "../src/db/system";
import { forOrg } from "../src/db/org-scope";
import { currentKekVersion, type CredentialEnv } from "../src/lib/credentials";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  // NO localhost fallback, unlike the read-only dev scripts: this script
  // MUTATES and its success message green-lights deleting the old KEK — a
  // silent local-db run would print "rotation complete" against the wrong
  // database and lead straight to bricking prod credentials.
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      "DATABASE_URL is required — point it explicitly at the database being rotated",
    );
    process.exit(1);
  }
  const env: CredentialEnv = {
    CREDENTIAL_KEK_CURRENT: process.env.CREDENTIAL_KEK_CURRENT ?? "",
    CREDENTIAL_KEK_PREVIOUS: process.env.CREDENTIAL_KEK_PREVIOUS,
  };
  if (!env.CREDENTIAL_KEK_CURRENT) {
    console.error(
      "CREDENTIAL_KEK_CURRENT is required (format v<N>:<base64 of 32 bytes>)",
    );
    process.exit(1);
  }
  console.log(`database host: ${new URL(databaseUrl).host}`);
  // Loud, early validation: currentKekVersion parses the KEK (and loadKeks
  // inside rewrapCredentials rejects a PREVIOUS whose version label equals
  // CURRENT's), so a malformed rotation config fails before any DB work.
  const target = currentKekVersion(env);
  console.log(
    `rotating stored credentials to KEK ${target}` +
      (env.CREDENTIAL_KEK_PREVIOUS ? " (previous configured)" : " (no previous — only same-version rows expected)") +
      (dryRun ? " [dry-run]" : ""),
  );

  const db = createDb({ DATABASE_URL: databaseUrl });

  if (dryRun) {
    // Honest dry-run: exactly the credential rows the real run would
    // rewrap (kek_version != target), grouped per org. No writes.
    const pending = await countCredentialsNeedingRewrap(db, target);
    const total = pending.reduce((sum, p) => sum + p.count, 0);
    for (const p of pending) {
      console.log(`  org ${p.orgId}: ${p.count} credential(s) need rewrap`);
    }
    console.log(
      `dry-run complete (no writes): ${total} credential(s) across ${pending.length} org(s) would be rewrapped to ${target}`,
    );
    return;
  }

  const orgIds = await listOrgIds(db);
  console.log(`${orgIds.length} orgs to sweep`);

  let rewrapped = 0;
  const failures: Array<{ orgId: string; error: string }> = [];
  for (const orgId of orgIds) {
    try {
      const count = await forOrg(db, orgId).connections.rewrapCredentials(env);
      rewrapped += count;
      if (count > 0) {
        console.log(`  org ${orgId}: rewrapped ${count}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ orgId, error: message });
      console.error(`  org ${orgId}: FAILED — ${message}`);
    }
  }

  if (failures.length > 0) {
    console.error(
      `\n${failures.length} org(s) failed — keep CREDENTIAL_KEK_PREVIOUS configured and re-run:`,
    );
    for (const f of failures) {
      console.error(`  ${f.orgId}: ${f.error}`);
    }
    process.exit(1);
  }
  console.log(
    `rotation complete: ${rewrapped} credential(s) rewrapped to ${target}. ` +
      "Safe to remove CREDENTIAL_KEK_PREVIOUS (repo secret) and re-run the Deploy workflow.",
  );
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
