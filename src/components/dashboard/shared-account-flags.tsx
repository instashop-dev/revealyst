import { Users } from "lucide-react";
import type { SharedAccountFlag } from "@/lib/shared-account";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { vendorLabel } from "@/lib/vendor-labels";

const REASON_LABELS: Record<string, string> = {
  round_the_clock: "round-the-clock activity",
  concurrent_usage: "concurrent sessions",
  volume_exceeds_team_median: "volume ≫ team median",
};

const CONFIDENCE_VARIANT: Record<string, "outline" | "secondary" | "destructive"> = {
  low: "outline",
  medium: "secondary",
  high: "destructive",
};

/**
 * Shared-account flags (§6.2): accounts whose usage pattern (round-the-clock,
 * concurrent sessions, volume ≫ team median — W2-K's detector) implies more
 * than one person. Adoption for those people is likely undercounted — the
 * callout says so honestly and points at the visibility-readiness playbook
 * (per-user keys, migrate shared Plus → Team) rather than fabricating
 * per-person numbers.
 */
export function SharedAccountFlags({ flags }: { flags: SharedAccountFlag[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Shared accounts</CardTitle>
        <CardDescription>
          Accounts used by more than one person — adoption may be undercounted.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {flags.length === 0 ? (
          <p className="text-muted-foreground">
            No shared accounts detected. Per-person attribution is clean.
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-2.5">
              {flags.map((flag) => (
                <li key={flag.subjectId} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Users className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 truncate">
                        {flag.externalId}
                        <span className="text-muted-foreground">
                          {" "}
                          · {vendorLabel(flag.vendor)}
                        </span>
                      </span>
                    </span>
                    <Badge
                      variant={CONFIDENCE_VARIANT[flag.confidence] ?? "secondary"}
                      className="shrink-0 capitalize"
                    >
                      {flag.confidence} confidence
                    </Badge>
                  </div>
                  <p className="pl-5 text-xs text-muted-foreground">
                    {flag.reasons
                      .map((r) => REASON_LABELS[r] ?? r)
                      .join(" · ")}
                    {flag.identityCount > 0
                      ? ` — ${flag.identityCount} linked so far`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Adoption for people sharing these accounts is likely undercounted.
              The visibility-readiness playbook (per-user keys; migrate shared
              plans to Team) restores per-person attribution — no new software.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
