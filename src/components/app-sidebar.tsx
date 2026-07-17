"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
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
import { ThemeToggle } from "@/components/theme-toggle";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { authClient } from "@/lib/auth-client";
import { navFor } from "@/lib/nav-items";

export function AppSidebar({
  org,
  role,
  user,
  isPlatformAdmin,
}: {
  org: { name: string; kind: "personal" | "team" | "system" };
  role: "admin" | "member";
  user: { name: string | null; email: string };
  isPlatformAdmin: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();

  // Item list / labels / gating live in the pure `navFor` config (U0.1) so
  // later phases edit config, not this JSX. This file still owns the rendering
  // (icons, aria-current, tooltips) unchanged.
  const navGroups = navFor({ orgKind: org.kind, role, isPlatformAdmin });

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
          {/* Workspace switcher: shows the active workspace and, on open, lets a
              multi-workspace user (e.g. a platform admin with a personal org +
              a team workspace) switch between them. */}
          <WorkspaceSwitcher currentOrg={org} />
        </div>
      </SidebarHeader>
      <SidebarContent>
        {/* WCAG 2.1 AA nav landmark (T2.6 item 2): one labeled <nav> wrapping
            all menu groups, so assistive tech can jump straight to primary
            navigation. Groups come from the pure `navFor` config. */}
        <nav aria-label="Primary">
          {navGroups.map((group) => (
            <SidebarGroup key={group.id}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => {
                    const isActive = pathname.startsWith(item.href);
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          isActive={isActive}
                          aria-current={isActive ? "page" : undefined}
                          tooltip={item.title}
                          render={<Link href={item.href} />}
                        >
                          <item.icon />
                          <span>{item.title}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </nav>
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
        {/* U0.8 theme switcher — system / light / dark, above sign-out. */}
        <div className="px-2 pb-1">
          <ThemeToggle />
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
