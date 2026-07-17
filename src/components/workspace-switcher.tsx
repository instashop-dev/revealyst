"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";

type Workspace = { id: string; name: string; kind: "personal" | "team" | "system" };

// Sidebar-header workspace switcher. Most users belong to exactly one workspace,
// so the list is fetched LAZILY on open (not on every authenticated page load) —
// the shared app shell stays one round-trip cheaper. Switching rides ADR 0004's
// "most-recent membership wins" resolution: POST bumps the chosen membership,
// then a full refresh re-resolves the active org server-side.
export function WorkspaceSwitcher({
  currentOrg,
}: {
  currentOrg: { name: string; kind: "personal" | "team" | "system" };
}) {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);

  async function loadOnOpen(open: boolean) {
    if (!open || workspaces !== null || loading) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/org/workspaces");
      if (!res.ok) {
        throw new Error(String(res.status));
      }
      const data = (await res.json()) as {
        activeOrgId: string;
        workspaces: Workspace[];
      };
      setWorkspaces(data.workspaces);
      setActiveId(data.activeOrgId);
    } catch {
      toast.error("Could not load your workspaces");
    } finally {
      setLoading(false);
    }
  }

  async function switchTo(id: string) {
    if (id === activeId || switching) {
      return;
    }
    setSwitching(true);
    const res = await fetch("/api/org/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: id }),
    });
    setSwitching(false);
    if (!res.ok) {
      toast.error("Could not switch workspace");
      return;
    }
    // Land on the dashboard of the newly active workspace and re-render the
    // whole shell (sidebar nav, kind branch) against the new org context.
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <DropdownMenu onOpenChange={loadOnOpen}>
      <DropdownMenuTrigger
        className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-0.5 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Switch workspace"
      >
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold">Revealyst</span>
          <span className="truncate text-xs text-muted-foreground">
            {currentOrg.name}
          </span>
        </div>
        <ChevronsUpDown className="ml-auto size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {loading ? (
            <div className="flex items-center gap-2 px-1.5 py-1.5 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Loading…
            </div>
          ) : workspaces && workspaces.length > 0 ? (
            workspaces.map((ws) => (
              <DropdownMenuItem
                key={ws.id}
                onClick={() => switchTo(ws.id)}
                disabled={switching}
              >
                <span className="truncate">{ws.name}</span>
                {ws.id === activeId ? (
                  <Check className="ml-auto size-4" />
                ) : null}
              </DropdownMenuItem>
            ))
          ) : (
            <div className="px-1.5 py-1.5 text-sm text-muted-foreground">
              No other workspaces.
            </div>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
