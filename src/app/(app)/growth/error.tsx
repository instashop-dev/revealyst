"use client";

import { RouteError } from "@/components/route-error";

export default function GrowthError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} />;
}
