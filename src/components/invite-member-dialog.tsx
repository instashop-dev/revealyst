"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Copy, UserRoundPlus } from "lucide-react";
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export function InviteMemberDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [busy, setBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setEmail("");
    setRole("member");
    setInviteLink(null);
    setCopied(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/org/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    setBusy(false);
    if (res.status === 409) {
      toast.error("A pending invite for this email already exists");
      return;
    }
    if (!res.ok) {
      toast.error(`Could not create invite (${res.status})`);
      return;
    }
    const data = (await res.json()) as { token: string };
    setInviteLink(`${window.location.origin}/invite/${data.token}`);
    router.refresh();
  }

  async function copy() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    toast.success("Invite link copied");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) reset();
      }}
    >
      <DialogTrigger render={<Button size="sm" />}>
        <UserRoundPlus data-icon="inline-start" />
        Invite member
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription>
            Invites grant dashboard access to this workspace. Share the link
            privately — anyone holding it can join until it expires (14 days)
            or is revoked.
          </DialogDescription>
        </DialogHeader>
        {inviteLink ? (
          <div className="flex flex-col gap-3">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="invite-link">Invite link</FieldLabel>
                <div className="flex gap-2">
                  <Input id="invite-link" readOnly value={inviteLink} />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={copy}
                    aria-label="Copy invite link"
                  >
                    {copied ? <Check /> : <Copy />}
                  </Button>
                </div>
                <FieldDescription>
                  This link is shown once — it isn&apos;t stored and can&apos;t
                  be retrieved later. Revoke it from the pending list if it
                  leaks.
                </FieldDescription>
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" onClick={() => setOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="invite-email">Email</FieldLabel>
                <Input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </Field>
              <Field>
                <FieldLabel>Role</FieldLabel>
                <ToggleGroup
                  value={[role]}
                  onValueChange={(value) => {
                    const next = value[0];
                    if (next === "admin" || next === "member") {
                      setRole(next);
                    }
                  }}
                  variant="outline"
                >
                  <ToggleGroupItem value="member">Member</ToggleGroupItem>
                  <ToggleGroupItem value="admin">Admin</ToggleGroupItem>
                </ToggleGroup>
                <FieldDescription>
                  Admins manage members, invites, and teams.
                </FieldDescription>
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="submit" disabled={busy || email.length === 0}>
                {busy && <Spinner data-icon="inline-start" />}
                Create invite link
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
