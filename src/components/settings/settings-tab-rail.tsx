"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { SettingsTab } from "@/lib/settings-nav";

/**
 * The Settings tab navigation (U3). Left rail on desktop, a horizontal
 * scrolling list on mobile — same routes either way (deep-linkable). The
 * active tab carries `aria-current="page"`. Rendered inside a labeled
 * `<nav>` so it is one discoverable landmark.
 */
export function SettingsTabRail({ tabs }: { tabs: SettingsTab[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings" className="md:w-48 md:shrink-0">
      <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:mx-0 md:flex-col md:overflow-visible md:px-0 md:pb-0">
        {tabs.map((tab) => {
          const active =
            pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={tab.key} className="shrink-0">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center rounded-md px-3 text-sm whitespace-nowrap transition-colors",
                  active
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                {tab.title}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
