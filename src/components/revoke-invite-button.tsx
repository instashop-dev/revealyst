"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function RevokeInviteButton({
  inviteId,
  email,
}: {
  inviteId: string;
  email: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function revoke() {
    setBusy(true);
    const res = await fetch(`/api/org/invites/${inviteId}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(`Could not revoke invite (${res.status})`);
      return;
    }
    toast.success(`Invite for ${email} revoked`);
    router.refresh();
  }

  return (
    <Button variant="destructive" size="sm" onClick={revoke} disabled={busy}>
      {busy && <Spinner data-icon="inline-start" />}
      Revoke
    </Button>
  );
}
