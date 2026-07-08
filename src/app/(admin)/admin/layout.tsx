import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { requireAdminContext } from "@/lib/admin-context";

// Authenticated + platform-admin-gated pages can't prerender: session and
// Cloudflare env exist only at request time (mirrors (app)/layout.tsx).
export const dynamic = "force-dynamic";

// Sibling route group to (app), deliberately NOT nested under it (ADR
// 0016): the customer-facing paywall/layout logic in (app)/layout.tsx must
// never run for /admin. This is the second (and only other) gate: every
// visit calls requireAdminContext(), which redirects non-admins and
// impersonating sessions to /dashboard before any admin markup renders.
export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireAdminContext();

  return (
    <SidebarProvider>
      <AdminSidebar />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-destructive/20 bg-destructive/5 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="text-sm font-medium text-destructive">
            Platform admin
          </span>
          <span className="text-sm text-muted-foreground">
            — internal console, not customer-facing
          </span>
        </header>
        <div className="flex flex-1 flex-col gap-6 p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
