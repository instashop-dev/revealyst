import { Cable, Check, Clock } from "lucide-react";
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
//
// `available` is the render-time env gate (ADR 0022): the SERVER caller
// checks whether the GitHub App secrets are configured (readCopilotAppConfig)
// and passes the result down. When false, the card shows an honest
// "not yet available" state with NO connect control — never a button that
// dead-ends at github.com or bounces back with an error. It flips
// automatically when the secrets sync (no code change).
export function GithubAppConnectCard({
  vendor,
  connected = false,
  available = true,
}: {
  vendor: GithubAppVendor;
  connected?: boolean;
  available?: boolean;
}) {
  return (
    <Card className={available ? undefined : "opacity-70"}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{vendor.label}</CardTitle>
          {connected ? (
            <Badge variant="outline">
              <Check data-icon="inline-start" />
              Connected
            </Badge>
          ) : !available ? (
            <Badge variant="outline">
              <Clock data-icon="inline-start" />
              Not yet available
            </Badge>
          ) : null}
        </div>
        <CardDescription>{vendor.blurb}</CardDescription>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">{vendor.requirements}</p>
        {available ? (
          <Button
            variant={connected ? "outline" : "default"}
            nativeButton={false}
            render={<a href={vendor.setupPath} />}
          >
            <Cable data-icon="inline-start" />
            {connected ? "Connect another org" : "Connect via GitHub App"}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            The {vendor.label} integration is going through final live
            verification and isn&apos;t connectable on this deployment yet.
          </p>
        )}
      </CardFooter>
    </Card>
  );
}
