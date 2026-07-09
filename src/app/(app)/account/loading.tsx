import { Skeleton } from "@/components/ui/skeleton";

export default function AccountLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="flex max-w-2xl flex-col gap-6">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-xl border p-4">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-56 max-w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
