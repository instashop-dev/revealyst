"use client";

import { usePathname } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

const TITLES: Record<string, string> = {
  "/dashboard": "Overview",
  // /account, /billing, /members, /teams, /people consolidated under /settings
  // (U3); the prefix match makes every /settings/* tab read "Settings". Device
  // pairing + local sync live under /settings/devices (ADR 0054, replacing the
  // retired /connections page).
  "/settings": "Settings",
};

function titleFor(pathname: string): string {
  // Boundary match (same rule as paywall-exempt.ts / domains.ts): a prefix
  // only matches at a path-segment boundary, so e.g. /settingsology never
  // reads as "Settings".
  const match = Object.keys(TITLES).find(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  return match ? TITLES[match] : "Revealyst";
}

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <span className="text-sm font-medium">{titleFor(pathname)}</span>
    </header>
  );
}
