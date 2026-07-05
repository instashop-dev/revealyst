import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createDb, type Db } from "../db/client";
import type { CredentialEnv } from "./credentials";

/**
 * Request-scoped context for API route handlers — the single allowlisted
 * createDb seam for routes (ADR 0002; scripts/check-org-scope.mjs), so
 * individual route files never touch the client factory. Deliberately NOT
 * cached at module scope: Workers cancel cross-request I/O.
 */
export function getApiContext(): { db: Db; env: CredentialEnv } {
  const { env } = getCloudflareContext();
  return { db: createDb(env), env: env as CredentialEnv };
}
