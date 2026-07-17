"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, ChevronsUpDown, LogOut, Plus } from "lucide-react";
import { toast } from "sonner";
import { CreateTeamWorkspaceDialog } from "@/components/create-team-workspace-dialog";
import { LeaveWorkspaceDialog } from "@/components/leave-workspace-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import {
  CREATE_TEAM_WORKSPACE_COPY,
  CREATE_TEAM_WORKSPACE_MENU_ITEM,
} from "@/lib/team-onboarding-copy";

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
  const [createOpen, setCreateOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);

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
    <>
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
          {/* Progressive disclosure (D-ONB-1): anyone can start a team
              workspace — a menu item, not a nav item or banner. Opens the
              shared create dialog, rendered as a sibling so it survives the
              menu closing on select. */}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            <span>{CREATE_TEAM_WORKSPACE_MENU_ITEM}</span>
          </DropdownMenuItem>
          {/* Leave the current workspace — a member-accessible action (Settings
              hides its admin tabs from members, so the switcher is the reachable
              home). Never offered for a personal workspace: it's the account's
              own home, and the server refuses it anyway. */}
          {currentOrg.kind !== "personal" ? (
            <DropdownMenuItem
              onClick={() => setLeaveOpen(true)}
              className="text-destructive focus:text-destructive"
            >
              <LogOut className="size-4" />
              <span>Leave workspace</span>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateTeamWorkspaceDialog
        endpoint="/api/workspaces"
        copy={CREATE_TEAM_WORKSPACE_COPY}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
      <LeaveWorkspaceDialog
        workspaceName={currentOrg.name}
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
      />
    </>
  );
}
