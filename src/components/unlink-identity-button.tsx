"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Unlink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/** Removes one subject→person identity link (method-agnostic). Admin-only,
 *  enforced server-side by the reconcile route. */
export function UnlinkIdentityButton({
  subjectId,
  personId,
}: {
  subjectId: string;
  personId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function unlink() {
    setBusy(true);
    const res = await fetch("/api/reconcile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unlink", subjectId, personId }),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(`Could not unlink (${res.status})`);
      return;
    }
    toast.success("Identity unlinked");
    router.refresh();
  }

  return (
    <Button
      size="xs"
      variant="ghost"
      onClick={unlink}
      disabled={busy}
      aria-label="Unlink identity"
    >
      {busy ? <Spinner /> : <Unlink />}
    </Button>
  );
}
