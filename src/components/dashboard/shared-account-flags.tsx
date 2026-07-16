import Link from "next/link";
import { Users } from "lucide-react";
import type { SharedAccountFlag } from "@/lib/shared-account";
import { Badge } from "@/components/ui/badge";
import { InfoTip } from "@/components/info-tip";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CONCEPT_GLOSSARY,
  methodologyAnchor,
  SHARED_ACCOUNT_REASON_LABELS,
} from "@/lib/metrics-glossary";
import { vendorLabel } from "@/lib/vendor-labels";

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
        <CardTitle className="flex items-center gap-1.5">
          Shared accounts
          <InfoTip
            label={CONCEPT_GLOSSARY.sharedAccounts.plainName}
            short={CONCEPT_GLOSSARY.sharedAccounts.shortWhat}
            learnMoreHref={`/methodology#${methodologyAnchor("sharedAccounts")}`}
          />
        </CardTitle>
        <CardDescription>
          Accounts used by more than one person — adoption may be undercounted.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {flags.length === 0 ? (
          <p className="text-muted-foreground">
            No usage patterns suggesting shared accounts in this window.
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
                        {flag.externalId ?? "Shared account"}
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
                      .map((r) => SHARED_ACCOUNT_REASON_LABELS[r] ?? r)
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
              The{" "}
              <Link
                href="/playbook"
                className="font-medium text-foreground underline"
              >
                shared-account migration guide
              </Link>{" "}
              (per-user keys; migrate shared plans to Team) restores per-person
              attribution — no new software.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
