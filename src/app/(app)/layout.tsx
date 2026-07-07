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

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const ctx = await requireAppContext();

  // Free-band paywall (PR4): an un-entitled workspace over the tracked-user
  // limit sees the upgrade paywall in place of the whole app. Enforced here,
  // the single shell every app page renders through, so no page can forget it —
  // and the same computeAccess gates the JSON APIs in handleApi.
  const access = await computeAccess(ctx.db, ctx.scope, ctx.org);
  if (access.blocked) {
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
      />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-6 p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
