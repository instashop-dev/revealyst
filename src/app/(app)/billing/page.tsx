import { redirect } from "next/navigation";
import { ManageSubscriptionButton } from "@/components/manage-subscription-button";
import { PageHeader } from "@/components/page-header";
import { UpgradeButton } from "@/components/upgrade-button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { subscriptionsForOrg } from "@/db/subscriptions";
import { requireAppContext } from "@/lib/api-context";
import { FREE_TRACKED_USER_LIMIT, trailing30dPeriod } from "@/lib/entitlements";
import { resolvePaddleClientConfig, type PaddleEnv } from "@/lib/paddle";
import { FOUNDER_DISCOUNT_PCT, listPriceDisplay } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const ctx = await requireAppContext();
  // Billing is an admin surface (like Members); the routes enforce the same.
  if (ctx.role !== "admin") {
    redirect("/dashboard");
  }

  // Same window the paywall enforces on, so the displayed count matches.
  const [entitlement, { trackedPersonIds }] = await Promise.all([
    subscriptionsForOrg(ctx.db, ctx.org.id).current(),
    ctx.scope.billing.trackedUsers(trailing30dPeriod()),
  ]);
  const trackedCount = trackedPersonIds.length;

  // Client-safe Paddle config; absent in an unconfigured env — degrade to a
  // notice rather than crashing the page.
  let clientConfig: ReturnType<typeof resolvePaddleClientConfig> | null = null;
  try {
    clientConfig = resolvePaddleClientConfig(ctx.env as PaddleEnv);
  } catch {
    clientConfig = null;
  }

  const isTeam = entitlement.plan === "team";
  const renewsAt = entitlement.subscription?.currentPeriodEnd;
  // Only promise the FOUNDER discount when it is actually configured for this
  // environment — otherwise checkout charges full price and the copy would be
  // an overclaim (review invariant b: no claim the system doesn't back).
  const hasFounderDiscount = Boolean((ctx.env as PaddleEnv).PADDLE_DISCOUNT_ID);

  return (
    <>
      <PageHeader
        title="Billing"
        description="Your plan, usage, and subscription."
      />
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <CardTitle className="flex items-center gap-2">
                {isTeam ? "Team" : "Personal"}
                <Badge variant={isTeam ? "default" : "outline"}>
                  {isTeam ? (entitlement.status ?? "active") : "Free"}
                </Badge>
              </CardTitle>
              <CardDescription>
                {isTeam
                  ? `${entitlement.quantity} seat${entitlement.quantity === 1 ? "" : "s"} billed per tracked user / month — ${listPriceDisplay()} list${hasFounderDiscount ? `, ${FOUNDER_DISCOUNT_PCT}% off with the FOUNDER discount where applied` : ""}.`
                  : `${trackedCount} of ${FREE_TRACKED_USER_LIMIT} free tracked users used.`}
              </CardDescription>
            </div>
            {isTeam ? (
              <ManageSubscriptionButton />
            ) : clientConfig ? (
              <UpgradeButton
                clientToken={clientConfig.clientToken}
                environment={clientConfig.environment}
              />
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {isTeam ? (
            renewsAt ? (
              <p>Renews {renewsAt.toLocaleDateString()}.</p>
            ) : (
              <p>Manage invoices, payment method, and cancellation in the portal.</p>
            )
          ) : clientConfig ? (
            <p>
              Team is {listPriceDisplay()} per tracked user / month.
              {hasFounderDiscount
                ? ` Early adopters get ${FOUNDER_DISCOUNT_PCT}% off with the FOUNDER discount, applied automatically at checkout.`
                : ""}
            </p>
          ) : (
            <p>Billing is not configured for this environment yet.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
