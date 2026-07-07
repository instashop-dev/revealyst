"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { apiRoutes } from "@/contracts/api";
import type { z } from "zod";

// Paddle Checkout overlay trigger (W3-M PR3). Loads Paddle.js, initializes it
// with the client-safe token, and on click asks the server to create a
// transaction (org_id bound server-side) before opening the overlay. Entitlement
// flips when the PR2 webhook lands, so success shows a "pending" state.

type CheckoutResponse = z.infer<(typeof apiRoutes)["billingCheckout"]["response"]>;

type PaddleGlobal = {
  Environment?: { set: (env: string) => void };
  Initialize?: (opts: {
    token: string;
    eventCallback?: (event: { name?: string }) => void;
  }) => void;
  Setup?: (opts: { token: string }) => void;
  Checkout: { open: (opts: { transactionId: string }) => void };
};

declare global {
  interface Window {
    Paddle?: PaddleGlobal;
  }
}

const PADDLE_JS = "https://cdn.paddle.com/paddle/v2/paddle.js";

export function UpgradeButton({
  clientToken,
  environment,
}: {
  clientToken: string;
  environment: "sandbox" | "production";
}) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;

    function init() {
      const paddle = window.Paddle;
      if (!paddle || cancelled) return;
      if (environment === "sandbox") paddle.Environment?.set("sandbox");
      paddle.Initialize?.({
        token: clientToken,
        eventCallback: (event) => {
          if (event.name === "checkout.completed") setDone(true);
        },
      });
      setReady(true);
    }

    if (window.Paddle) {
      init();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${PADDLE_JS}"]`,
    );
    const script = existing ?? document.createElement("script");
    script.src = PADDLE_JS;
    script.onload = init;
    if (!existing) document.body.appendChild(script);
    return () => {
      cancelled = true;
    };
  }, [clientToken, environment]);

  async function upgrade() {
    setBusy(true);
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST" });
      if (!res.ok) {
        toast.error("Could not start checkout. Please try again.");
        return;
      }
      const { transactionId } = (await res.json()) as CheckoutResponse;
      window.Paddle?.Checkout.open({ transactionId });
    } catch {
      toast.error("Network error — checkout not started.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="text-sm text-muted-foreground">
        Payment received — your workspace will switch to Team in a moment.
      </p>
    );
  }

  return (
    <Button onClick={upgrade} disabled={!ready || busy}>
      {busy ? "Opening checkout…" : "Upgrade to Team"}
    </Button>
  );
}
