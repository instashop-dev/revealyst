import { Skeleton } from "@/components/ui/skeleton";

// U5 CLS: the connections page is a card GRID (connector cards + the polled /
// local sections), not a table — the old TableSkeleton reserved a single
// bordered row-list and shifted layout hard on hydration. This mirrors the
// real shape: header, intro line, the connected-cards grid, the available-
// connectors section, and the local-sync 2-up section (agent card +
// transparency panel) — the common fully-populated state, so the reserve
// covers what most orgs actually render (U5 review finding: a 2-section
// skeleton undershot the 3–4-section real page).
function CardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-20" />
      </div>
      <Skeleton className="h-4 w-full max-w-56" />
      <Skeleton className="h-11 w-28" />
    </div>
  );
}

export default function ConnectionsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <Skeleton className="h-4 w-64 max-w-full" />
      <div className="grid gap-4 sm:grid-cols-2">
        <CardSkeleton />
        <CardSkeleton />
      </div>
      <div className="mt-6 flex flex-col gap-4">
        <Skeleton className="h-6 w-48" />
        <div className="grid gap-4 sm:grid-cols-2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
      {/* Local sync section: agent card + transparency panel, 2-up. */}
      <div className="mt-6 flex flex-col gap-4">
        <Skeleton className="h-6 w-40" />
        <div className="grid gap-4 sm:grid-cols-2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    </div>
  );
}
