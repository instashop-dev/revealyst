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

/**
 * Shared-account flags (§6.2): subjects shared by ≥2 people. Adoption for those
 * people is likely undercounted — the callout says so honestly and points at
 * the visibility-readiness playbook (per-user keys, migrate shared Plus → Team)
 * rather than fabricating per-person numbers.
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
            <ul className="flex flex-col gap-2">
              {flags.map((flag) => (
                <li
                  key={flag.subjectId}
                  className="flex items-center justify-between gap-2"
                >
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
                  <Badge variant="secondary">
                    {flag.identityCount} people
                  </Badge>
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
