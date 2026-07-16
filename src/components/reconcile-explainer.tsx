"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ATTRIBUTION_GLOSSARY } from "@/lib/metrics-glossary";

const DISMISS_KEY = "revealyst.reconcile.explainer.dismissed";

/**
 * First-visit explainer for the Match accounts page: three plain sentences on
 * how usage attributes — to a person, to a key/project, or to a whole account
 * — sourced from ATTRIBUTION_GLOSSARY (never re-typed here). Dismissal is
 * remembered client-side in localStorage; no new table, no server state.
 */
export function ReconcileExplainer() {
  // Render nothing until we've read localStorage on the client, so the server
  // markup and first client paint agree (no hydration mismatch, no flash of a
  // banner the user already dismissed).
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setMounted(true);
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Private-mode / storage-disabled: hide for this session anyway.
    }
  }

  if (!mounted || dismissed) return null;

  const rows = [
    ATTRIBUTION_GLOSSARY.person,
    ATTRIBUTION_GLOSSARY.key_project,
    ATTRIBUTION_GLOSSARY.account,
  ];

  return (
    <Card className="mb-6">
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium">
            How the accounts your tools report map to real people
          </p>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={dismiss}
            aria-label="Dismiss explainer"
          >
            <X />
          </Button>
        </div>
        <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
          {rows.map((row) => (
            <li key={row.label} className="flex flex-col">
              <span className="font-medium text-foreground">{row.label}</span>
              <span>{row.shortWhat}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
