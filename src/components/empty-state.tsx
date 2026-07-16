import type { LucideIcon } from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyContent,
} from "@/components/ui/empty";

/**
 * Standard empty state for data surfaces. Honesty rule: the description
 * says why the surface is empty and what makes it fill — never a fake
 * teaser number.
 *
 * `variant="inline"` (U0.5) reproduces the compact dashed-box idiom the
 * companion cards used to hand-roll individually (a left-aligned headline +
 * body inside a small dashed box, no icon-in-a-circle) — folded in here so
 * the honesty rule lives in one component instead of being copy-pasted.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
  variant = "default",
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  children?: React.ReactNode;
  variant?: "default" | "inline";
}) {
  if (variant === "inline") {
    return (
      <div className="rounded-lg border border-dashed p-4">
        {Icon ? (
          <Icon
            className="mb-2 size-4 text-muted-foreground"
            aria-hidden="true"
          />
        ) : null}
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        {children ? <div className="mt-3">{children}</div> : null}
      </div>
    );
  }

  return (
    <Empty className="border">
      <EmptyHeader>
        {Icon ? (
          <EmptyMedia variant="icon">
            <Icon />
          </EmptyMedia>
        ) : null}
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {children ? <EmptyContent>{children}</EmptyContent> : null}
    </Empty>
  );
}
