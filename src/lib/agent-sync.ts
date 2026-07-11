// Single source of truth for user-facing Revealyst Agent install/run copy —
// the FREE_TRACKED_USER_LIMIT pattern (src/lib/entitlements.ts): UI
// surfaces render these constants so onboarding/Sync copy can never drift
// from what is actually published on npm (the R6 drift bug class). Pure and
// db-free so public pages may import it. The CLI package itself is
// deliberately never imported by the app (its types.ts mirror rule) — the
// release process bumps AGENT_PIN_VERSION alongside
// packages/revealyst-agent/package.json.

export const AGENT_PACKAGE_NAME = "@revealyst/agent";

/** Minimum published version the in-app copy pins. Pinning tightens the
 * "fresh parser per sync" guarantee (a warm npx cache may lag — plan A6)
 * and bounds the blast radius of a bad publish (R7). */
export const AGENT_PIN_VERSION = "0.2.0";

/** What users actually type after `npx `. The unscoped `revealyst-agent`
 * alias package also resolves, but copy always renders the canonical
 * scoped name. */
export const AGENT_RUN_SPEC = `${AGENT_PACKAGE_NAME}@^${AGENT_PIN_VERSION}`;

export function agentLoginCommand(token: string): string {
  return `npx ${AGENT_RUN_SPEC} login --token ${token}`;
}

export const AGENT_SYNC_COMMAND = `npx ${AGENT_RUN_SPEC} sync`;

export const AGENT_DRY_RUN_COMMAND = `npx ${AGENT_RUN_SPEC} sync --dry-run`;
