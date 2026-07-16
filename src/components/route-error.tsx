"use client";

// Shared route-level error boundary body (U1). Next.js `error.tsx` files must be
// client components and receive `{ error, reset }`; this holds the plain-English
// apology + a retry button so each route's error.tsx stays a two-line wrapper
// and the copy/behaviour can't drift between routes. Plain English, no stack
// traces or internals shown to the user (CLAUDE.md writing rule).

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function RouteError({
  error,
  reset,
  title = "Something went wrong loading this page",
  description = "This is on us, not you. Try again in a moment — if it keeps happening, your data is safe and nothing was lost.",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  description?: string;
}) {
  useEffect(() => {
    // Surface for server logs / observability; never shown to the user.
    // eslint-disable-next-line no-console
    console.error("[route-error]", error);
  }, [error]);

  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-4 py-8">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-lg font-semibold tracking-tight">
            {title}
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            {description}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => reset()}>
          <RotateCcw data-icon="inline-start" />
          Try again
        </Button>
      </CardContent>
    </Card>
  );
}
