import { Lock } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { SETTINGS_COPY } from "@/lib/settings-nav";

/**
 * In-place explanation an admin-only Settings tab renders when a member
 * deep-links it (plan §5.7). The per-page server-side role check stays
 * authoritative — this is what it shows INSTEAD of the controls, rather than
 * redirecting away with no trace.
 */
export function AdminOnlyNotice() {
  return (
    <EmptyState
      icon={Lock}
      title={SETTINGS_COPY.adminOnly.title}
      description={SETTINGS_COPY.adminOnly.body}
    />
  );
}
