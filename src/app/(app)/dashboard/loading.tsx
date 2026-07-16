import { Skeleton } from "@/components/ui/skeleton";

// U1.1: the loading skeleton reserves the recomposed Today layout's heights so
// the real content doesn't shift it (CLS budget, R11): page header, hero card,
// then the 12-col actions/rail split (two action-card heights on the left, the
// nudge + trust card on the right), then the collapsed diagnostics row.
export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      {/* Hero (full-width). */}
      <Skeleton className="h-40" />

      {/* Actions (col 1–7) + rail (col 8–12). */}
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="flex flex-col gap-4 lg:col-span-7">
          <Skeleton className="h-56" />
          <Skeleton className="h-40" />
        </div>
        <div className="flex flex-col gap-4 lg:col-span-5">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      </div>

      {/* Collapsed diagnostics expander. */}
      <Skeleton className="h-16" />
    </div>
  );
}
