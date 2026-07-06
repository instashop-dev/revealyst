import type { VendorId } from "../../src/contracts/attribution";
import type { Connector } from "../../src/contracts/connector";
import { anthropicConsoleConnector } from "../../src/connectors/anthropic";
import { readDashboardView } from "../../src/lib/dashboard-view";
import { recomputeOrg } from "../../src/scoring/recompute";

// THE cross-workstream seam registry (W1-S owns it — rule 6).
//
// The E2E harness resolves its connector and score-engine implementations
// HERE and nowhere else. Both entries below are the production
// implementations that merged in W1-D and W1-F — this file is where the
// wave-gate E2E stops being a harness exercise and becomes a run over
// shippable code. `recomputeOrg` is the same entrypoint the nightly/
// post-backfill recompute path calls in production, not a re-implementation
// of it, so the E2E proves the real engine, not a lookalike.
//
// Flip points:
//  - W2-J connectors (copilot / cursor / openai) → add entries below
//  - W2-L dashboard read → resolveDashboardView (below): the production team
//    dashboard the privacy-default E2E asserts against.

const CONNECTORS: Partial<Record<VendorId, Connector>> = {
  anthropic_console: anthropicConsoleConnector,
};

export function resolveConnector(vendor: VendorId): Connector {
  const connector = CONNECTORS[vendor];
  if (!connector) {
    throw new Error(
      `no connector registered for '${vendor}' — add it to tests/harness/seams.ts when its workstream merges`,
    );
  }
  return connector;
}

export function resolveRecompute() {
  return recomputeOrg;
}

/** The production team-dashboard read (W2-L). The privacy-default gate item —
 * "team-only pseudonymized verified" — asserts assertTeamOnlyPseudonymized over
 * the view this resolves, so the E2E runs over shippable code, not a stand-in. */
export function resolveDashboardView() {
  return readDashboardView;
}
