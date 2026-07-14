import type { ReactNode } from "react";

/**
 * A small uppercase group label that titles a section of cards. Shared by the
 * dashboard's Team Intelligence sections and the one-page maturity report, which
 * previously each defined their own byte-identical copy of this. Renders a real
 * <h2> so the section is reachable by screen-reader heading navigation.
 */
export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </h2>
  );
}
