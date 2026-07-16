import Link from "next/link";
import { Laptop } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireAppContext } from "@/lib/api-context";
import {
  desktopConnectPayloadSchema,
  isStartPayloadFresh,
  type DesktopConnectPayload,
} from "@/lib/desktop-pairing";

// /desktop/connect (Desktop Agent T2.2, ADR 0045) — the session-authed
// consent screen the desktop agent opens in the system browser. Shows what
// device is asking and which workspace it will connect to; approving POSTs
// a plain HTML form to /api/desktop/auth/consent, which mints the one-time
// code and redirects back into the app via its revealyst:// link. D-DA-2:
// Personal workspaces only — a Team workspace gets an honest "not yet"
// state with no approve path.

export const metadata = {
  title: "Connect your computer · Revealyst",
};

const ERROR_COPY: Record<string, { title: string; body: string }> = {
  expired: {
    title: "This connection link has expired",
    body: "Connection links only work for 10 minutes. Go back to the Revealyst app on your computer and start again.",
  },
  already_used: {
    title: "This request was already approved",
    body: "Check the Revealyst app on your computer — it should be connected. If it isn't, start the connection again from the app.",
  },
  team_org: {
    title: "Desktop devices aren't available for team workspaces yet",
    body: "You can connect your computer from a personal workspace. We're working on team support.",
  },
  invalid: {
    title: "Something's wrong with this connection link",
    body: "Go back to the Revealyst app on your computer and start the connection again.",
  },
};

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{body}</CardDescription>
      </CardHeader>
    </Card>
  );
}

const PLATFORM_LABEL: Record<DesktopConnectPayload["platform"], string> = {
  macos: "Mac",
  windows: "Windows PC",
};

export default async function DesktopConnectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireAppContext();
  const params = await searchParams;

  const header = (
    <PageHeader
      title="Connect your computer"
      description="The Revealyst app on your computer is asking to connect."
    />
  );

  const errorKey = typeof params.error === "string" ? params.error : null;
  if (errorKey && ERROR_COPY[errorKey]) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Notice {...ERROR_COPY[errorKey]} />
      </div>
    );
  }

  // D-DA-2: no mint path for Team workspaces — the honest state, not a
  // disabled button.
  if (ctx.org.kind !== "personal") {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Notice {...ERROR_COPY.team_org} />
      </div>
    );
  }

  const parsed = desktopConnectPayloadSchema.safeParse(params);
  if (!parsed.success) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Notice {...ERROR_COPY.invalid} />
      </div>
    );
  }
  const payload = parsed.data;
  if (!isStartPayloadFresh(payload.issued)) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Notice {...ERROR_COPY.expired} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {header}
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Laptop className="size-5" aria-hidden />
            {payload.name}
          </CardTitle>
          <CardDescription>
            {PLATFORM_LABEL[payload.platform]} · Revealyst app{" "}
            {payload.version}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            If you approve, this computer will send daily AI usage summaries
            to <span className="font-medium text-foreground">{ctx.org.name}</span>.
            It never sends your prompts, code, or files. You can disconnect it
            anytime from Connections.
          </p>
          <form
            method="post"
            action="/api/desktop/auth/consent"
            className="flex items-center gap-3"
          >
            {Object.entries({
              pairing: payload.pairing,
              challenge: payload.challenge,
              state: payload.state,
              name: payload.name,
              platform: payload.platform,
              arch: payload.arch,
              version: payload.version,
              installation: payload.installation,
              issued: String(payload.issued),
            }).map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value} />
            ))}
            <Button type="submit">Approve and connect</Button>
            <Button
              variant="ghost"
              nativeButton={false}
              render={<Link href="/dashboard" />}
            >
              Cancel
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
