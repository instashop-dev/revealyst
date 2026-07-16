import { Skeleton } from "@/components/ui/skeleton";

// U1.3: reserve the Growth layout's heights so streamed content doesn't shift
// (CLS budget, R11): header, hero, then the 7/5 split (capability list left,
// missions + milestones rail right).
export default function GrowthLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <Skeleton className="h-40" />

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="flex flex-col gap-4 lg:col-span-7">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-72" />
        </div>
        <div className="flex flex-col gap-4 lg:col-span-5">
          <Skeleton className="h-56" />
          <Skeleton className="h-40" />
        </div>
      </div>
    </div>
  );
}
