"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, ShieldCheck } from "lucide-react";
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
import { inputClassName } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { authClient } from "@/lib/auth-client";

/**
 * Ban/unban action (better-auth admin plugin — server-side gated +
 * audited, ADR 0016). Banning asks for a reason (shown to the banned user
 * on their next sign-in attempt); unban is a direct action, no dialog —
 * there's nothing to configure, just reversing the ban.
 */
export function UserBanDialog({
  userId,
  userName,
  banned,
  banReason,
  disabled,
  disabledReason,
}: {
  userId: string;
  userName: string;
  banned: boolean;
  banReason?: string | null;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function unban() {
    setBusy(true);
    const res = await authClient.admin.unbanUser({ userId });
    setBusy(false);
    if (res.error) {
      toast.error(res.error.message ?? "Could not unban this user");
      return;
    }
    toast.success(`${userName || "User"} unbanned`);
    router.refresh();
  }

  async function ban(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await authClient.admin.banUser({
      userId,
      banReason: reason || undefined,
    });
    setBusy(false);
    if (res.error) {
      toast.error(res.error.message ?? "Could not ban this user");
      return;
    }
    toast.success(`${userName || "User"} banned`);
    setOpen(false);
    setReason("");
    router.refresh();
  }

  if (banned) {
    const button = (
      <Button
        variant="outline"
        size="sm"
        onClick={unban}
        disabled={disabled || busy}
      >
        {busy ? <Spinner data-icon="inline-start" /> : <ShieldCheck data-icon="inline-start" />}
        Unban
      </Button>
    );
    if (disabled && disabledReason) {
      return (
        <Tooltip>
          <TooltipTrigger render={<span className="inline-block" />}>{button}</TooltipTrigger>
          <TooltipContent>{disabledReason}</TooltipContent>
        </Tooltip>
      );
    }
    return (
      <>
        {button}
        {banReason ? (
          <span className="text-xs text-muted-foreground">Reason: {banReason}</span>
        ) : null}
      </>
    );
  }

  const trigger = (
    <DialogTrigger
      render={<Button variant="destructive" size="sm" disabled={disabled} />}
    >
      <Ban data-icon="inline-start" />
      Ban
    </DialogTrigger>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {disabled && disabledReason ? (
        <Tooltip>
          <TooltipTrigger render={<span className="inline-block" />}>{trigger}</TooltipTrigger>
          <TooltipContent>{disabledReason}</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ban {userName || "this user"}?</DialogTitle>
          <DialogDescription>
            Banned users can't sign in. The reason is shown to them on their next
            sign-in attempt, and recorded in the audit log.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={ban} className="flex flex-col gap-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="ban-reason">Reason (optional)</FieldLabel>
              {/* biome-ignore lint/a11y/noLabelWithoutControl: label is bound via htmlFor/id */}
              <textarea
                id="ban-reason"
                className={inputClassName}
                style={{ height: "auto", minHeight: "4.5rem" }}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Terms of service violation"
                rows={3}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={busy}>
              {busy && <Spinner data-icon="inline-start" />}
              Ban user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
