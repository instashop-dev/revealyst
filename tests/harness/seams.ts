import type { VendorId } from "../../src/contracts/attribution";
import type { Connector } from "../../src/contracts/connector";
import { referenceAnthropicConsole } from "./reference-anthropic";
import { evaluateScore } from "./reference-scoring";

// THE cross-workstream seam registry (W1-S owns it — rule 6).
//
// The E2E harness resolves its connector and score-engine implementations
// HERE and nowhere else. Today both entries are W1-S reference stubs so the
// ingest→score path is green before W1-D/W1-F merge; when a real
// implementation lands on MAIN (never read another workstream's branch —
// rule 3), the swap is one line in this file and the same E2E becomes the
// wave-gate run over production code.
//
// Flip points:
//  - W1-D merges src connector for anthropic_console  → import it, replace entry
//  - W1-F merges the score engine                     → replace resolveScoreEvaluator
//  - W2-J connectors (copilot / cursor / openai)      → add entries

const CONNECTORS: Partial<Record<VendorId, Connector>> = {
  anthropic_console: referenceAnthropicConsole,
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

export function resolveScoreEvaluator() {
  return evaluateScore;
}
