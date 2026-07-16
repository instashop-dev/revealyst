import { Check, CircleSlash } from "lucide-react";
import { scopeClaimsFor } from "@/connectors/scope-claims";
import {
  AGENT_NEVER_COLLECTED,
  AGENT_SENT_FIELDS,
} from "@/lib/agent-collection-schema";

// U4.2 — the inline "what we read / what we never read" line shown beside each
// connect card during onboarding. It is a compact CLAIM SURFACE and, like the
// Connections-page drawer, NEVER re-types vendor prose (W3-P discipline):
//  • vendor cards read U2's fact-checked `scopeClaimsFor` strings verbatim;
//  • the agent card reads the on-device collection schema
//    (`agent-collection-schema.ts`) — the same source as the transparency
//    panel, so the copy cannot drift.
// A sweep test (onboarding-scope-explainer.test.tsx) pins that every rendered
// claim string comes from one of those modules, not from this file.

const AGENT_VENDOR = "claude_code_local";

/** The standing, cross-connector privacy claim. Rendered ONLY where the schema
 * PROVES it — see `agentNeverReadsPrompts` below. Not a per-vendor claim. */
export const STANDING_PRIVACY_LINE =
  "We read counts and timing, never your prompts.";

/** True when the on-device schema proves the agent never reads prompt content —
 * the precondition for showing the standing line. Derived, not asserted: if a
 * future schema change started sending prompt text, this flips and the line is
 * withheld rather than becoming a false claim. */
export function agentNeverReadsPrompts(): boolean {
  const neverReadsPrompts = AGENT_NEVER_COLLECTED.some((s) => /prompt/i.test(s));
  // Everything whose VALUE leaves the device is a token count or the model id —
  // never free text.
  const onlyCountsLeave = AGENT_SENT_FIELDS.every((f) =>
    /token|model/i.test(f.field),
  );
  return neverReadsPrompts && onlyCountsLeave;
}

function ReadRow({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2 text-muted-foreground">
      <Check
        aria-hidden="true"
        className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-500"
      />
      <span>{text}</span>
    </li>
  );
}

function NeverRow({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2 text-muted-foreground">
      <CircleSlash
        aria-hidden="true"
        className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
      />
      <span>{text}</span>
    </li>
  );
}

/**
 * Compact scope line for a connect card. `vendor` is the connector id
 * (`anthropic_console`, `openai`, `cursor`, `github_copilot`) or the agent id
 * (`claude_code_local`). Pure — no hooks, no drawer — so it stays a11y-clean and
 * import-safe in the client wizard. Renders nothing when no claims are
 * registered for the vendor (never a fabricated line).
 */
export function OnboardingScopeExplainer({ vendor }: { vendor: string }) {
  if (vendor === AGENT_VENDOR) {
    return (
      <div className="flex flex-col gap-1.5 text-sm">
        {agentNeverReadsPrompts() ? (
          <p className="text-xs font-medium text-foreground">
            {STANDING_PRIVACY_LINE}
          </p>
        ) : null}
        <ul className="flex flex-col gap-1">
          {AGENT_NEVER_COLLECTED.slice(0, 2).map((line) => (
            <NeverRow key={line} text={line} />
          ))}
        </ul>
      </div>
    );
  }

  const claims = scopeClaimsFor(vendor);
  if (!claims) return null;
  const topMeasure = claims.measures[0];
  const topGap = claims.cannotMeasure[0];

  return (
    <ul className="flex flex-col gap-1 text-sm">
      {topMeasure ? <ReadRow text={topMeasure} /> : null}
      {topGap ? <NeverRow text={topGap} /> : null}
    </ul>
  );
}
