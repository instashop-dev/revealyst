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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { CreateTeamWorkspaceDialogCopy } from "@/lib/team-onboarding-copy";

// Shared team-workspace create dialog (D-ONB-1). One implementation for both the
// user-facing switcher affordance (POST /api/workspaces) and the platform-admin
// dashboard button (POST /api/admin/team-workspaces) — only the endpoint + copy
// differ. On success the creator is enrolled as the new workspace's admin and it
// becomes their most-recent membership, so the refresh lands them in it (ADR
// 0004/0051); they return to any other workspace with the sidebar switcher.
//
// Trigger-flexible: pass `trigger` for a self-contained button (admin button);
// or drive `open`/`onOpenChange` yourself and omit `trigger` when the opener
// lives elsewhere (the switcher's dropdown menu item — a DialogTrigger inside a
// menu would unmount with the menu on select).
export function CreateTeamWorkspaceDialog({
  endpoint,
  copy,
  trigger,
  open,
  onOpenChange,
}: {
  endpoint: string;
  copy: CreateTeamWorkspaceDialogCopy;
  trigger?: React.ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const isControlled = open !== undefined;
  const actualOpen = isControlled ? open : internalOpen;
  const setOpen = (next: boolean) => {
    if (isControlled) {
      onOpenChange?.(next);
    } else {
      setInternalOpen(next);
    }
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
    } catch {
      setBusy(false);
      toast.error(copy.errorFallback(0));
      return;
    }
    setBusy(false);
    if (!res.ok) {
      // Surface the server's plain-English message when it sent one (e.g. the
      // per-user cap), else a generic fallback keyed on the status.
      let message = copy.errorFallback(res.status);
      try {
        const data = (await res.json()) as { error?: unknown };
        if (typeof data.error === "string" && data.error.length > 0) {
          message = data.error;
        }
      } catch {
        // Non-JSON body — keep the fallback.
      }
      toast.error(message);
      return;
    }
    toast.success(copy.success(name.trim()));
    setOpen(false);
    setName("");
    // Land on the dashboard of the new workspace and re-render the whole shell
    // (sidebar nav, kind branch) against the new org context.
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <Dialog open={actualOpen} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger render={trigger} /> : null}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="workspace-name">{copy.nameLabel}</FieldLabel>
              <Input
                id="workspace-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={1}
                maxLength={120}
                autoFocus
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={busy || name.trim().length === 0}>
              {busy && <Spinner data-icon="inline-start" />}
              {copy.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
