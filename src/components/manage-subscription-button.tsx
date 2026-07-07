"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { apiRoutes } from "@/contracts/api";
import type { z } from "zod";

// Opens the Paddle hosted customer portal (W3-M PR3). Fetches a fresh
// authenticated session on click (never cached) and sends the customer to the
// portal overview, where they can see invoices, update payment, and cancel.

type PortalResponse = z.infer<(typeof apiRoutes)["billingPortal"]["response"]>;

export function ManageSubscriptionButton() {
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true);
    try {
      const res = await fetch("/api/billing/portal");
      if (!res.ok) {
        toast.error("Could not open the billing portal. Please try again.");
        return;
      }
      const { overviewUrl } = (await res.json()) as PortalResponse;
      window.open(overviewUrl, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Network error — could not open the portal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" onClick={open} disabled={busy}>
      {busy ? "Opening…" : "Manage subscription"}
    </Button>
  );
}
