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
 * PROVES it — see `agentNeverReadsPrompts` below. Not a per-vendor claim.
 * Completeness (invariant b): it must OWN everything whose value leaves the
 * device — token counts, timing, model ids, AND the closed-enum "which AI apps
 * are open" label — while still truthfully saying it never reads prompts. */
export const STANDING_PRIVACY_LINE =
  "We read counts, timing, model names, and which AI apps are open — never your prompts.";

/** The bounded value SHAPES a sent field may carry (schema `sentValueShape`).
 * A sent field whose value is one of these is provably NOT free text: a number,
 * the sanitized model id, or a value from a closed enum. Anything else (or a
 * sent field with NO shape marker) is treated as free text — fail-closed. */
const BOUNDED_SENT_VALUE_SHAPES = new Set(["count", "model_id", "closed_enum"]);

/** True when the on-device schema proves the agent never reads prompt content —
 * the precondition for showing the standing line. Derived, not asserted: if a
 * future schema change started sending prompt text (a sent field with no bounded
 * `sentValueShape`), this flips and the line is withheld rather than becoming a
 * false claim. Keyed off the STRUCTURAL shape marker, not the field name, so a
 * bounded closed-enum label (e.g. `ai_tool_used`) counts as safe while genuine
 * free text does not. Defaults to empty if the schema export is somehow absent
 * (fail-closed under a partial mock). */
export function agentNeverReadsPrompts(): boolean {
  const neverReadsPrompts = (AGENT_NEVER_COLLECTED ?? []).some((s) =>
    /prompt/i.test(s),
  );
  // Every value that leaves the device is a bounded shape — a count, the model
  // id, or a closed-enum label — never free text. A sent field lacking a
  // bounded shape marker (e.g. a hypothetical prompt-text field) makes this
  // false, withholding the line.
  const onlyBoundedValuesLeave = (AGENT_SENT_FIELDS ?? []).every(
    (f) =>
      f.sentValueShape !== undefined &&
      BOUNDED_SENT_VALUE_SHAPES.has(f.sentValueShape),
  );
  return neverReadsPrompts && onlyBoundedValuesLeave;
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
