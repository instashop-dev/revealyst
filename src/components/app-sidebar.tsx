"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Cable,
  CreditCard,
  LayoutDashboard,
  LogOut,
  ScanFace,
  ShieldCheck,
  UserRound,
  UserRoundCog,
  UserRoundPlus,
  UsersRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";

const NAV_ITEMS = [
  { title: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { title: "Teams", href: "/teams", icon: UsersRound },
  { title: "People", href: "/people", icon: UserRound },
  { title: "Connections", href: "/connections", icon: Cable },
  { title: "Account", href: "/account", icon: UserRoundCog },
];

// Admin-only surfaces (ADR 0004): Members/Reconcile are also role-gated
// server-side (they read org data). Compliance is grouped here because rollout
// is an admin concern, but it is *static guidance with no data reads* (§7), so
// it needs no server-side gate — unlike its data-reading siblings.
const ADMIN_NAV_ITEMS = [
  { title: "Members", href: "/members", icon: UserRoundPlus },
  { title: "Reconcile", href: "/reconcile", icon: ScanFace },
  { title: "Billing", href: "/billing", icon: CreditCard },
  { title: "Compliance", href: "/compliance", icon: ShieldCheck },
];

export function AppSidebar({
  org,
  role,
  user,
}: {
  org: { name: string; kind: "personal" | "team" | "system" };
  role: "admin" | "member";
  user: { name: string | null; email: string };
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary font-heading text-sm font-bold text-primary-foreground">
            R
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold">Revealyst</span>
            <span className="truncate text-xs text-muted-foreground">
              {org.name}
            </span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>
            {org.kind === "personal" ? "Personal workspace" : "Workspace"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={pathname.startsWith(item.href)}
                    tooltip={item.title}
                    render={<Link href={item.href} />}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {role === "admin" ? (
          <SidebarGroup>
            <SidebarGroupLabel>Administration</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {ADMIN_NAV_ITEMS.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={pathname.startsWith(item.href)}
                      tooltip={item.title}
                      render={<Link href={item.href} />}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>
      <SidebarFooter>
        <SidebarSeparator />
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm">{user.name || user.email}</span>
            <span className="truncate text-xs text-muted-foreground">
              {user.email}
            </span>
          </div>
          <Badge variant="outline" className="shrink-0 capitalize">
            {role}
          </Badge>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={signOut}>
              <LogOut />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
