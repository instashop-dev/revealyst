"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

// Confirm-then-leave dialog for the workspace switcher. Controlled by the
// switcher (rendered as a sibling so it survives the menu closing on select,
// mirroring CreateTeamWorkspaceDialog). Leaving removes the caller's own
// membership from the ACTIVE workspace; the server re-resolves their next active
// org (personal workspace, or another membership) on refresh.
export function LeaveWorkspaceDialog({
  workspaceName,
  open,
  onOpenChange,
}: {
  workspaceName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function leave() {
    setBusy(true);
    const res = await fetch("/api/org/leave", { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      // Surface the server's plain-English guard message (last admin, etc.).
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      toast.error(data?.error ?? "Could not leave this workspace");
      return;
    }
    toast.success(`You left ${workspaceName}`);
    onOpenChange(false);
    // Land on the dashboard and re-render the whole shell against the newly
    // resolved active workspace.
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Leave {workspaceName}?</DialogTitle>
          <DialogDescription>
            You'll lose access to this workspace and its data. You can only
            rejoin if someone invites you again.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button variant="destructive" onClick={leave} disabled={busy}>
            {busy && <Spinner data-icon="inline-start" />}
            Leave workspace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
