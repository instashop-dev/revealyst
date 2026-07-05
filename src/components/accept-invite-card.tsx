"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

export function AcceptInviteCard({
  token,
  orgName,
  role,
}: {
  token: string;
  orgName: string;
  role: "admin" | "member";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    const res = await fetch("/api/invites/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(`Could not join (${res.status})`);
      return;
    }
    toast.success(`Welcome to ${orgName}`);
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Join {orgName}</CardTitle>
        <CardDescription>
          You&apos;ve been invited as a{" "}
          <span className="font-medium capitalize">{role}</span>. Joining
          switches your active workspace to {orgName}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={accept} disabled={busy} className="w-full">
          {busy && <Spinner data-icon="inline-start" />}
          Join workspace
        </Button>
      </CardContent>
    </Card>
  );
}
