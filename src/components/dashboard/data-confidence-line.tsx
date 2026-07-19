import { InfoTip } from "@/components/info-tip";
import type { CoverageAggregate } from "@/components/dashboard/data-trust-card";

/**
 * P0b — the single persistent data-confidence line (Team Manager Dashboard plan
 * §3 P0; analysis §11). Replaces the scattered per-card confidence badges and
 * the bottom "Data trust" section as the DEFAULT confidence read: one compact,
 * count-only line stating how complete the picture is. The full DataTrustCard +
 * SharedAccountFlags are NOT deleted — they move behind progressive disclosure
 * ("See data & attribution detail"). Honest by construction: aggregate counts
 * only, never a named person, and an explicit "No people resolved yet" when
 * nothing has been identified.
 */
export function DataConfidenceLine({
  coverage,
  gapsCount,
  sharedCount,
}: {
  coverage: CoverageAggregate | null;
  gapsCount: number;
  sharedCount: number;
}) {
  const parts: string[] = [];
  if (coverage && coverage.total > 0) {
    const multiSource = coverage.total - coverage.single;
    parts.push(
      `${coverage.total} ${coverage.total === 1 ? "person" : "people"} identified (${multiSource} on 2+ sources)`,
    );
  } else {
    parts.push("No people resolved yet");
  }
  parts.push(`${gapsCount} reporting ${gapsCount === 1 ? "gap" : "gaps"}`);
  parts.push(
    `${sharedCount} shared ${sharedCount === 1 ? "account" : "accounts"} unresolved`,
  );

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border px-3 py-2 text-sm text-muted-foreground">
      <span className="font-medium text-foreground">Data confidence</span>
      <span>— {parts.join(" · ")}</span>
      <InfoTip
        label="Data confidence"
        short="How complete and trustworthy this picture is — reporting gaps, shared accounts, and how many sources feed each identified person. Full detail is in the data section below."
      />
    </div>
  );
}
