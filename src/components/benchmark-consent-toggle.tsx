"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

// Anonymized-benchmark opt-in (W2-H PR5, ADR 0008). Reads the current consent
// on mount and persists changes. Promises nothing — records consent only.
export function BenchmarkConsentToggle() {
  const [granted, setGranted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/benchmark-consent");
        if (res.ok && active) {
          const { granted } = (await res.json()) as { granted: boolean };
          setGranted(granted);
        }
      } catch {
        // leave default (false); the toggle still works on change
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function change(next: boolean) {
    setBusy(true);
    const previous = granted;
    setGranted(next); // optimistic
    try {
      const res = await fetch("/api/benchmark-consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ granted: next }),
      });
      if (!res.ok) {
        setGranted(previous);
        toast.error("Could not save your preference");
      }
    } catch {
      setGranted(previous);
      toast.error("Network error — preference not saved");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id="benchmark-consent"
        checked={granted}
        disabled={!loaded || busy}
        onCheckedChange={(next) => change(next === true)}
      />
      <div className="flex flex-col gap-1">
        <Label htmlFor="benchmark-consent">
          Contribute my scores to anonymized benchmarks
        </Label>
        <p className="text-xs text-muted-foreground">
          Opt in to include your (anonymized, aggregated) scores in published
          benchmarks. Off by default; change anytime.
        </p>
      </div>
    </div>
  );
}
