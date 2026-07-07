"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { apiRoutes } from "@/contracts/api";
import type { z } from "zod";

// Paddle Checkout overlay trigger (W3-M PR3). Loads Paddle.js, initializes it
// with the client-safe token, and on click asks the server to create a
// transaction (org_id bound server-side) before opening the overlay.
//
// Entitlement flips only when the PR2 webhook lands, so between "checkout
// completed" and that webhook the org is still on the free plan. To avoid a
// refresh re-showing the upgrade button (and letting an anxious admin start a
// SECOND paid transaction), a completed checkout is persisted to localStorage
// and the button shows a "processing" state that survives reloads and
// auto-refreshes until the webhook lands (which unmounts this button).

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
const PENDING_KEY = "revealyst_upgrade_pending";
/** After this long we assume the webhook won't arrive (canceled / failed) and
 * let the user try again rather than trapping them in "processing". */
const PENDING_MAX_AGE_MS = 15 * 60 * 1000;
const REFRESH_MS = 5000;

function readPending(): boolean {
  try {
    const at = Number(localStorage.getItem(PENDING_KEY));
    if (!at || Date.now() - at > PENDING_MAX_AGE_MS) {
      localStorage.removeItem(PENDING_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function UpgradeButton({
  clientToken,
  environment,
}: {
  clientToken: string;
  environment: "sandbox" | "production";
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);

  // Restore a pending upgrade across reloads.
  useEffect(() => {
    if (readPending()) setPending(true);
  }, []);

  // While an upgrade is processing, poll for the webhook-driven entitlement
  // flip; when it lands, the parent (paywall/billing) re-renders without us.
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => {
      if (!readPending()) {
        setPending(false);
        return;
      }
      router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [pending, router]);

  useEffect(() => {
    let cancelled = false;

    function init() {
      const paddle = window.Paddle;
      if (!paddle || cancelled) return;
      if (environment === "sandbox") paddle.Environment?.set("sandbox");
      paddle.Initialize?.({
        token: clientToken,
        eventCallback: (event) => {
          if (event.name === "checkout.completed") {
            try {
              localStorage.setItem(PENDING_KEY, String(Date.now()));
            } catch {
              // non-fatal: the in-memory pending state still applies
            }
            setPending(true);
          }
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

  if (pending) {
    return (
      <p className="text-sm text-muted-foreground">
        Payment received — activating your workspace. This can take a moment.
      </p>
    );
  }

  return (
    <Button onClick={upgrade} disabled={!ready || busy}>
      {busy ? "Opening checkout…" : "Upgrade to Team"}
    </Button>
  );
}
