import { ManageSubscriptionButton } from "@/components/manage-subscription-button";
import { AdminOnlyNotice } from "@/components/settings/admin-only-notice";
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
import { SETTINGS_COPY } from "@/lib/settings-nav";

export const dynamic = "force-dynamic";

// Billing tab (U3) — admin-only, moved from the retired /billing page. Because
// it now lives under /settings/*, it stays reachable over the free band via the
// layout's PAYWALL_EXEMPT_PREFIXES — an over-band admin can always reach it to
// upgrade or manage their subscription (plan §5.7 paywall invariant).
export default async function SettingsBillingPage() {
  const ctx = await requireAppContext("/settings/billing");
  if (ctx.role !== "admin") {
    return <AdminOnlyNotice />;
  }

  // Same window the paywall enforces on, so the displayed count matches.
  const [entitlement, { trackedPersonIds }] = await Promise.all([
    subscriptionsForOrg(ctx.db, ctx.org.id).current(),
    ctx.scope.billing.trackedUsers(trailing30dPeriod()),
  ]);
  const trackedCount = trackedPersonIds.length;

  // Client-safe Paddle config; absent in an unconfigured env — degrade to an
  // honest "billing unavailable" notice rather than crashing the tab.
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
    <div className="flex max-w-2xl flex-col gap-6">
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
        <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
          {isTeam ? (
            renewsAt ? (
              <p>Renews {renewsAt.toLocaleDateString()}.</p>
            ) : (
              <p>
                Manage invoices, payment method, and cancellation in the portal.
              </p>
            )
          ) : clientConfig ? (
            <p>
              Team is {listPriceDisplay()} per tracked user / month.
              {hasFounderDiscount
                ? ` Early adopters get ${FOUNDER_DISCOUNT_PCT}% off with the FOUNDER discount, applied automatically at checkout.`
                : ""}
            </p>
          ) : (
            // Honest degrade: the plan + usage above still render; only the
            // upgrade path is unavailable while billing is unconfigured.
            <p>Billing is temporarily unavailable. Your plan and usage are shown above.</p>
          )}
          <p className="text-xs">{SETTINGS_COPY.trackedUserDefinition}</p>
        </CardContent>
      </Card>
    </div>
  );
}
