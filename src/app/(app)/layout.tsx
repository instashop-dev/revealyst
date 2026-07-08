import { headers } from "next/headers";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { UpgradePaywall } from "@/components/upgrade-paywall";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { computeAccess } from "@/lib/access";
import { requireAppContext } from "@/lib/api-context";
import { resolvePaddleClientConfig, type PaddleEnv } from "@/lib/paddle";

// Authenticated pages can't prerender: session + Cloudflare env exist only
// at request time.
export const dynamic = "force-dynamic";

// Paths that must stay reachable even when the org is paywall-blocked — the
// page-shell analog of handleApi's `allowOverFreeBand` (src/lib/api-route.ts).
// /account is the one route an over-band, un-entitled user needs to reach to
// stop being blocked at all: deleting their account. Without this exemption
// they'd see only the paywall and could never delete (ADR 0015, review finding).
const PAYWALL_EXEMPT_PREFIXES = ["/account"];

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const ctx = await requireAppContext();
  const pathname = (await headers()).get("x-pathname") ?? "";
  const paywallExempt = PAYWALL_EXEMPT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  // Free-band paywall (PR4): an un-entitled workspace over the tracked-user
  // limit sees the upgrade paywall in place of the whole app. Enforced here,
  // the single shell every app page renders through, so no page can forget it —
  // and the same computeAccess gates the JSON APIs in handleApi.
  const access = await computeAccess(ctx.db, ctx.scope, ctx.org);
  if (access.blocked && !paywallExempt) {
    let clientConfig: { clientToken: string; environment: "sandbox" | "production" } | null =
      null;
    try {
      clientConfig = resolvePaddleClientConfig(ctx.env as PaddleEnv);
    } catch {
      clientConfig = null;
    }
    return (
      <UpgradePaywall
        trackedUsers={access.trackedUsers}
        limit={access.limit}
        canUpgrade={ctx.role === "admin"}
        clientConfig={clientConfig}
      />
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar
        org={{ name: ctx.org.name, kind: ctx.org.kind }}
        role={ctx.role}
        user={{ name: ctx.user.name ?? null, email: ctx.user.email }}
        isPlatformAdmin={ctx.isPlatformAdmin}
      />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-6 p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
