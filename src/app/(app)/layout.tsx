import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { requireAppContext } from "@/lib/api-context";

// Authenticated pages can't prerender: session + Cloudflare env exist only
// at request time.
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const ctx = await requireAppContext();
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
