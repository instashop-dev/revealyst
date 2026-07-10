"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Admin budget editor (W4-V). Sets the org's monthly spend ceiling; the alert
// thresholds keep their configured values (default 50/80/100%). Dollars in the
// field, cents on the wire (metric_records spend_cents are integer cents).
export function BudgetEditor({
  initialLimitCents,
  thresholds,
}: {
  initialLimitCents: number | null;
  thresholds: number[];
}) {
  const router = useRouter();
  const [dollars, setDollars] = useState(
    initialLimitCents != null ? (initialLimitCents / 100).toString() : "",
  );
  const [busy, setBusy] = useState(false);

  async function save() {
    const parsed = Number(dollars);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.error("Enter a monthly budget greater than $0");
      return;
    }
    const monthlyLimitCents = Math.round(parsed * 100);
    setBusy(true);
    try {
      const res = await fetch("/api/budget", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthlyLimitCents }),
      });
      if (!res.ok) {
        toast.error("Could not save the budget");
        return;
      }
      toast.success("Budget saved");
      router.refresh();
    } catch {
      toast.error("Network error — budget not saved");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="monthly-budget">Monthly budget (USD)</Label>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">$</span>
          <Input
            id="monthly-budget"
            type="number"
            inputMode="decimal"
            min="0"
            step="1"
            className="max-w-40 tabular-nums"
            value={dollars}
            onChange={(e) => setDollars(e.target.value)}
            placeholder="0"
          />
          <Button onClick={save} disabled={busy}>
            {initialLimitCents != null ? "Update budget" : "Set budget"}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        You&apos;ll see an in-app alert when observed month-to-date spend crosses{" "}
        {thresholds.join("%, ")}% of this budget. Alerts reflect observed burn
        from day-grain vendor data, not a real-time overspend block.
      </p>
    </div>
  );
}
