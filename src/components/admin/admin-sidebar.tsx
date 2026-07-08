"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Gauge, ScrollText, UsersRound } from "lucide-react";
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

// The admin shell's own sidebar (ADR 0016, Feature 3) — a sibling of
// AppSidebar, not a variant of it: nothing here is shared with the
// customer-facing nav, so an app-shell change can never accidentally leak
// into /admin. Users and Audit route to pages that don't exist yet
// (PR3/PR6) — linked anyway per the approved plan; they 404 until then.
const ADMIN_NAV_ITEMS = [
  { title: "Overview", href: "/admin", icon: Gauge },
  { title: "Users", href: "/admin/users", icon: UsersRound },
  { title: "Audit", href: "/admin/audit", icon: ScrollText },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10 font-heading text-sm font-bold text-destructive">
            R
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold">Revealyst</span>
            <Badge variant="destructive" className="w-fit">
              Platform admin
            </Badge>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {ADMIN_NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={
                      item.href === "/admin"
                        ? pathname === "/admin"
                        : pathname.startsWith(item.href)
                    }
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
      </SidebarContent>
      <SidebarFooter>
        <SidebarSeparator />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Back to app"
              render={<Link href="/dashboard" />}
            >
              <ArrowLeft />
              <span>Back to app</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
