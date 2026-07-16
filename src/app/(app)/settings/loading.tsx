import { Skeleton } from "@/components/ui/skeleton";

// Shell-shaped skeleton (U3): the header + rail resolve near-instantly, so this
// mainly reserves the content column height to keep CLS low while a tab's own
// data loads.
export default function SettingsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="flex flex-col gap-6 md:flex-row md:gap-8">
        <div className="flex gap-1 md:w-48 md:shrink-0 md:flex-col">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-24 md:w-full" />
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-3 rounded-xl border p-4">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-56 max-w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
