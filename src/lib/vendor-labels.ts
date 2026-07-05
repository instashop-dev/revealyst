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
