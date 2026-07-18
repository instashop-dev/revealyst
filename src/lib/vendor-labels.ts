import type { VendorId } from "@/contracts/attribution";

/** Display names for the frozen vendor enum. */
export const VENDOR_LABELS: Record<VendorId, string> = {
  github_copilot: "GitHub Copilot",
  cursor: "Cursor",
  anthropic_console: "Anthropic Console",
  anthropic_claude_enterprise: "Claude Enterprise",
  openai: "OpenAI",
  claude_code_local: "Claude Code (local agent)",
};

export function vendorLabel(vendor: string): string {
  return VENDOR_LABELS[vendor as VendorId] ?? vendor;
}

/**
 * The only vendor still syncing after the agent-first pivot (ADR 0056): the
 * local Claude Code agent, managed on Settings → Devices. `satisfies VendorId`
 * pins it to the frozen vendor union so a rename fails typecheck rather than
 * silently misclassifying every connector.
 */
export const LIVE_AGENT_VENDOR = "claude_code_local" satisfies VendorId;

/**
 * True for a retired polled connector (ADR 0056). Polling was removed, so
 * these rows are frozen history: they no longer update, and there is no live
 * place to reconnect them (Settings → Devices manages only the local agent).
 * Callers use this to keep dead connectors from showing a fresh sync badge or
 * a "needs attention" CTA that can never be acted on (invariant b).
 */
export function isLegacyConnectorVendor(vendor: string): boolean {
  return vendor !== LIVE_AGENT_VENDOR;
}
