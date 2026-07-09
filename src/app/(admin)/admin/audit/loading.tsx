import { Skeleton } from "@/components/ui/skeleton";

export default function AdminAuditLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="flex flex-wrap items-end gap-3 rounded-xl border p-4">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-20" />
      </div>
      <div className="flex flex-col gap-2 rounded-xl border p-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}
