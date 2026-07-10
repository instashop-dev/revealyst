import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      {/* One full card + a lighter secondary block: personal orgs render only a
          single settings card, so a neutral shape avoids visibly collapsing
          from two cards to one when the page resolves. */}
      <div className="flex max-w-2xl flex-col gap-6">
        <div className="flex flex-col gap-3 rounded-xl border p-4">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-56 max-w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
        <Skeleton className="h-16 w-full max-w-md rounded-xl opacity-50" />
      </div>
    </div>
  );
}
