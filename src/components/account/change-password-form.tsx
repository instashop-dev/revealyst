"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";

export function ChangePasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    setBusy(false);
    if (res.error) {
      toast.error(res.error.message ?? "Could not change your password");
      return;
    }
    toast.success("Password changed");
    setCurrentPassword("");
    setNewPassword("");
  }

  // GitHub-OAuth-only accounts have no password credential — Better Auth's
  // changePassword always 400s (CREDENTIAL_ACCOUNT_NOT_FOUND) for them, and
  // there's no client-exposed way to set an initial password for an OAuth
  // account. Show that plainly instead of a form that can never succeed.
  if (!hasPassword) {
    return (
      <Alert>
        <AlertTitle>
          You signed in with GitHub — there&apos;s no password to change on
          this account.
        </AlertTitle>
      </Alert>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="current-password">Current password</FieldLabel>
          <Input
            id="current-password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="new-password">New password</FieldLabel>
          <Input
            id="new-password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
          />
        </Field>
      </FieldGroup>
      <div>
        <Button
          type="submit"
          disabled={
            busy || currentPassword.length === 0 || newPassword.length < 8
          }
        >
          {busy && <Spinner data-icon="inline-start" />}
          Change password
        </Button>
      </div>
    </form>
  );
}
