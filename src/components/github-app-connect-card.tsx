import { Cable, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { GithubAppVendor } from "@/lib/vendor-connect-meta";

// Connect card for a GitHub-App vendor (Copilot). Presentational only (no
// hooks / server-only deps) so both the server-rendered connections page and
// the "use client" onboarding wizard can render it. The "Connect" control is a
// plain <a> to the setup route — it 30x's to github.com, so never a <Link>
// (a soft-nav would be CORS-blocked cross-origin) and never a fetch.
export function GithubAppConnectCard({
  vendor,
  connected = false,
}: {
  vendor: GithubAppVendor;
  connected?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{vendor.label}</CardTitle>
          {connected && (
            <Badge variant="outline">
              <Check data-icon="inline-start" />
              Connected
            </Badge>
          )}
        </div>
        <CardDescription>{vendor.blurb}</CardDescription>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">{vendor.requirements}</p>
        <Button
          variant={connected ? "outline" : "default"}
          nativeButton={false}
          render={<a href={vendor.setupPath} />}
        >
          <Cable data-icon="inline-start" />
          {connected ? "Connect another org" : "Connect via GitHub App"}
        </Button>
      </CardFooter>
    </Card>
  );
}
