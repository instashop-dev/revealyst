import { headers } from "next/headers";
import { AppSidebar } from "@/components/app-sidebar";
import { ImpersonationBanner } from "@/components/admin/impersonation-banner";
import { RouteFocusManager } from "@/components/route-focus";
import { SiteHeader } from "@/components/site-header";
import { UpgradePaywall } from "@/components/upgrade-paywall";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { computeAccess } from "@/lib/access";
import { requireAppContext } from "@/lib/api-context";
import { resolvePaddleClientConfig, type PaddleEnv } from "@/lib/paddle";
import { isPaywallExempt } from "@/lib/paywall-exempt";
import { timeStage } from "@/lib/request-timing";

// Authenticated pages can't prerender: session + Cloudflare env exist only
// at request time.
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // The signed-out bounce carries the full destination automatically —
  // requireAppContext derives ?next= from x-pathname/x-search itself, so the
  // concurrent no-arg calls in pages produce the same redirect as this one.
  const ctx = await requireAppContext();
  const pathname = (await headers()).get("x-pathname") ?? "";
  // Paywall exemption (ADR 0015/0018) lives in a pure module so it can be
  // unit-tested — see src/lib/paywall-exempt.ts. Consolidating billing +
  // account under /settings/* keeps them reachable over the band automatically.
  const paywallExempt = isPaywallExempt(pathname);

  // Platform-admin impersonation (ADR 0016, PR5/Feature 6): a persistent
  // banner must stay visible for the whole authenticated shell, including
  // the paywall branch below — an impersonated user whose org is over the
  // free band must still be able to end impersonation.
  const impersonating = ctx.session.session.impersonatedBy
    ? {
        name: ctx.session.user.name ?? ctx.session.user.email,
        userId: ctx.session.user.id,
      }
    : null;

  // Free-band paywall (PR4): an un-entitled workspace over the tracked-user
  // limit sees the upgrade paywall in place of the whole app. Enforced here,
  // the single shell every app page renders through, so no page can forget it —
  // and the same computeAccess gates the JSON APIs in handleApi.
  const access = await timeStage("access", () =>
    computeAccess(ctx.db, ctx.scope, ctx.org),
  );
  if (access.blocked && !paywallExempt) {
    let clientConfig: { clientToken: string; environment: "sandbox" | "production" } | null =
      null;
    try {
      clientConfig = resolvePaddleClientConfig(ctx.env as PaddleEnv);
    } catch {
      clientConfig = null;
    }
    return (
      <>
        {impersonating && (
          <ImpersonationBanner
            name={impersonating.name}
            impersonatedUserId={impersonating.userId}
          />
        )}
        <UpgradePaywall
          trackedUsers={access.trackedUsers}
          limit={access.limit}
          canUpgrade={ctx.role === "admin"}
          clientConfig={clientConfig}
        />
      </>
    );
  }

  return (
    <>
      {/* WCAG 2.1 AA skip link (T2.6 item 1): first focusable element in the
          shell, hidden until it receives keyboard focus, jumping straight to
          the real <main> below (id passed through SidebarInset's props
          spread — see src/components/ui/sidebar.tsx). */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-sm focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>
      {/* U5: announce client-side route changes to assistive tech by moving
          focus to <main> — the sidebar-link click otherwise strands focus. */}
      <RouteFocusManager />
      <SidebarProvider>
        <AppSidebar
          org={{ name: ctx.org.name, kind: ctx.org.kind }}
          role={ctx.role}
          user={{ name: ctx.user.name ?? null, email: ctx.user.email }}
          isPlatformAdmin={ctx.isPlatformAdmin}
        />
        {/* tabIndex={-1} lets both the skip link and RouteFocusManager move
            focus here. `outline-none` + `focus-visible:ring` differentiates
            the two arrival paths precisely: RouteFocusManager's programmatic
            .focus() never sets :focus-visible (silent, no ring), while the
            skip link's keyboard-initiated jump does — so the sighted keyboard
            user SEES that the jump landed (WCAG 2.4.7; a blanket outline-none
            here was a U5 review finding). */}
        <SidebarInset
          id="main-content"
          tabIndex={-1}
          className="outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {impersonating && (
            <ImpersonationBanner
              name={impersonating.name}
              impersonatedUserId={impersonating.userId}
            />
          )}
          <SiteHeader />
          <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </>
  );
}
