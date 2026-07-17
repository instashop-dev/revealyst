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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

// Admin control on Settings → People: remove another member's login from this
// workspace. Confirm-before-destructive (a small dialog, matching
// DeleteAccountDialog). Never rendered for the current user — self-removal goes
// through the switcher's "Leave workspace".
export function RemoveMemberDialog({
  userId,
  label,
}: {
  userId: string;
  /** The member's display name or email — what the admin recognizes. */
  label: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    const res = await fetch(`/api/org/members/${encodeURIComponent(userId)}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (!res.ok) {
      // Surface the server's plain-English guard message (last admin, owner).
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      toast.error(data?.error ?? `Could not remove ${label}`);
      return;
    }
    toast.success(`${label} removed from this workspace`);
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
          />
        }
      >
        Remove
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {label}?</DialogTitle>
          <DialogDescription>
            They'll immediately lose access to this workspace and its data. This
            doesn't delete their account — you can invite them back later.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button variant="destructive" onClick={remove} disabled={busy}>
            {busy && <Spinner data-icon="inline-start" />}
            Remove member
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
