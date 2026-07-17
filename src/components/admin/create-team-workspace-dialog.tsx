"use client";

import { Plus } from "lucide-react";
import { CreateTeamWorkspaceDialog as SharedCreateTeamWorkspaceDialog } from "@/components/create-team-workspace-dialog";
import { Button } from "@/components/ui/button";
import { ADMIN_CREATE_TEAM_WORKSPACE_COPY } from "@/lib/team-onboarding-copy";

// Platform-admin action: provision a new team workspace from the /admin
// dashboard. A thin wrapper over the shared create dialog
// (src/components/create-team-workspace-dialog.tsx) with the admin endpoint +
// copy — so the admin seam and the user-facing switcher flow share one
// implementation. On success the admin is enrolled as the new workspace's admin
// and lands in it (ADR 0004/0051).
export function CreateTeamWorkspaceDialog() {
  return (
    <SharedCreateTeamWorkspaceDialog
      endpoint="/api/admin/team-workspaces"
      copy={ADMIN_CREATE_TEAM_WORKSPACE_COPY}
      trigger={
        <Button size="sm">
          <Plus data-icon="inline-start" />
          New workspace
        </Button>
      }
    />
  );
}
