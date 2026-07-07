import { cn } from "@/lib/utils";

const SIZES = {
  sm: "size-6 rounded-md text-xs",
  md: "size-8 rounded-lg text-sm",
  lg: "size-12 rounded-xl text-xl",
} as const;

export function BrandMark({
  size = "md",
  className,
}: {
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center bg-primary font-heading font-bold text-primary-foreground",
        SIZES[size],
        className,
      )}
    >
      R
    </div>
  );
}
