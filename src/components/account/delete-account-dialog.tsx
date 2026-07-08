"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";

export function DeleteAccountDialog({ hasPassword }: { hasPassword: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    // GitHub-OAuth-only accounts have no password to verify — Better Auth
    // falls back to requiring a fresh session (signed in within the last 24h)
    // when no password is sent, so omit the field entirely for them rather
    // than sending one that can never be correct.
    const res = hasPassword
      ? await authClient.deleteUser({ password })
      : await authClient.deleteUser({});
    setBusy(false);
    if (res.error) {
      // Surfaces the gate messages (active subscription / other members),
      // wrong-password errors, and (for OAuth-only accounts) Better Auth's
      // own "session expired, re-authenticate" message.
      toast.error(res.error.message ?? "Could not delete your account");
      return;
    }
    toast.success("Your account has been deleted");
    setOpen(false);
    router.push("/sign-in");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="destructive" />}>
        Delete account
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>
            This permanently deletes your account and personal workspace,
            including its connections and data. This cannot be undone.
            {hasPassword
              ? " Enter your password to confirm."
              : " Since you signed in with GitHub, you'll need to have signed in recently to confirm — if this fails, sign out, sign back in, and try again."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {hasPassword && (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="delete-password">Password</FieldLabel>
                <Input
                  id="delete-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </Field>
            </FieldGroup>
          )}
          <DialogFooter>
            <Button
              type="submit"
              variant="destructive"
              disabled={busy || (hasPassword && password.length === 0)}
            >
              {busy && <Spinner data-icon="inline-start" />}
              Delete account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
