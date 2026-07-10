import { Skeleton } from "@/components/ui/skeleton";

// Mirrors the indexes page: PageHeader + the two-card workbench (builder card
// then published-indexes card). Follows the sibling settings/spend/dashboard
// loading states' Skeleton style.
export default function IndexesLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-96 w-full rounded-xl" />
      <Skeleton className="h-56 w-full rounded-xl" />
    </div>
  );
}
