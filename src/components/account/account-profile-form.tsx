"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";

export function AccountProfileForm({
  name: initialName,
  email,
}: {
  name: string;
  email: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);

  const unchanged = name.trim() === initialName.trim();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await authClient.updateUser({ name: name.trim() });
    setBusy(false);
    if (res.error) {
      toast.error(res.error.message ?? "Could not update your name");
      return;
    }
    toast.success("Name updated");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="account-name">Display name</FieldLabel>
          <Input
            id="account-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            required
            minLength={1}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="account-email">Email</FieldLabel>
          <Input id="account-email" value={email} readOnly disabled />
          <FieldDescription>
            Your email address can&apos;t be changed here.
          </FieldDescription>
        </Field>
      </FieldGroup>
      <div>
        <Button type="submit" disabled={busy || unchanged || name.trim().length === 0}>
          {busy && <Spinner data-icon="inline-start" />}
          Save changes
        </Button>
      </div>
    </form>
  );
}
