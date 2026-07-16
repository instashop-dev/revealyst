import type { ReactNode } from "react";
import { ConnectorCard } from "@/components/connector-card";
import { ConnectorScope } from "@/components/connector-scope";
import type { ScopeClaims } from "@/connectors/scope-claims";

/**
 * U2 — one connected connection rendered through the shared U0.6 ConnectorCard
 * shell: vendor name + status badge, the two-line measures/can't-measure
 * summary (with a drawer to the full list), one primary action, and the
 * admin manage menu in the secondary slot.
 *
 * Presentation only — it owns no state and no vendor knowledge. The page
 * decides what actions a viewer may take (a non-admin member simply gets no
 * `secondaryAction`), so read-only rendering is a matter of which slots are
 * passed, never a disabled control.
 */
export function ConnectionCard({
  displayName,
  vendorLabel,
  claims,
  statusBadge,
  primaryAction,
  secondaryAction,
}: {
  displayName: string;
  vendorLabel: string;
  /** Fact-checked scope claims for this vendor (src/connectors/scope-claims). */
  claims: ScopeClaims;
  statusBadge: ReactNode;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
}) {
  return (
    <ConnectorCard
      vendorName={displayName}
      summary={vendorLabel}
      statusBadge={statusBadge}
      primaryAction={primaryAction}
      secondaryAction={secondaryAction}
    >
      <ConnectorScope vendorName={vendorLabel} claims={claims} />
    </ConnectorCard>
  );
}
