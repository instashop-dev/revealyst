import Link from "next/link";
import { AcceptInviteCard } from "@/components/accept-invite-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { previewInvite } from "@/db/invites";
import { requireAppContext } from "@/lib/api-context";

export const dynamic = "force-dynamic";

const DEAD_INVITE_COPY = {
  invalid: "This invite link isn't recognized — check it was copied fully.",
  expired: "This invite has expired. Ask an admin for a fresh link.",
  used: "This invite was already used. Ask an admin for a fresh link.",
  revoked: "This invite was revoked. Ask an admin for a fresh link.",
} as const;

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // Signed-out visitors round-trip through sign-in and land back here.
  const ctx = await requireAppContext(`/invite/${token}`);
  const preview = await previewInvite(ctx.db, token);

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      {preview.status === "valid" ? (
        <AcceptInviteCard
          token={token}
          orgName={preview.orgName}
          role={preview.role}
        />
      ) : (
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Invite unavailable</CardTitle>
            <CardDescription>{DEAD_INVITE_COPY[preview.status]}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="w-full"
              render={<Link href="/dashboard" />}
            >
              Back to dashboard
            </Button>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
