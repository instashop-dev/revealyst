import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TEAM_OVERVIEW_COPY } from "@/lib/team-overview-copy";

/**
 * Board-ready CSV download (W5-H deliverable 4). A plain anchor to the
 * `handleApi`-gated export route — the route's `Content-Disposition:
 * attachment` header makes the browser download it, so no client JS is needed.
 * Base-nova: an `<a>` trigger renders via `render` + `nativeButton={false}`.
 */
export function MaturityExportButton() {
  return (
    <Button
      variant="outline"
      size="sm"
      nativeButton={false}
      render={<a href="/api/maturity/export" download />}
    >
      <Download data-icon="inline-start" />
      {TEAM_OVERVIEW_COPY.maturity.exportCsv}
    </Button>
  );
}
