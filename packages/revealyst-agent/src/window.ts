import type { DateWindow } from "./types";

/** Trailing inclusive UTC-day window ending today: the sync default.
 * Local logs only retain ~30 days (connector-facts §5), so `days` beyond
 * retention just yields empty days. */
export function trailingWindow(now: Date, days: number): DateWindow {
  if (!Number.isInteger(days) || days < 1) {
    throw new Error("days must be a positive integer");
  }
  const end = now.toISOString().slice(0, 10);
  const startDate = new Date(now.getTime() - (days - 1) * 86_400_000);
  return { start: startDate.toISOString().slice(0, 10), end };
}
