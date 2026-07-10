"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

/**
 * Workspace rename (ADR 0018). PATCH /api/settings with `{ name }`. Admin-only
 * at the route; the page only renders this for admins. Personal orgs can rename
 * their workspace too — this card is shown in both modes.
 */
export function WorkspaceNameForm({ name: initialName }: { name: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);

  const trimmed = name.trim();
  const unchanged = trimmed === initialName.trim();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (unchanged || trimmed.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        toast.error(
          res.status === 403
            ? "Only workspace admins can rename the workspace"
            : "Could not rename the workspace",
        );
        return;
      }
      toast.success("Workspace renamed");
      router.refresh();
    } catch {
      toast.error("Network error — workspace not renamed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="workspace-name">Workspace name</FieldLabel>
          <Input
            id="workspace-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={1}
          />
        </Field>
      </FieldGroup>
      <div>
        <Button type="submit" disabled={busy || unchanged || trimmed.length === 0}>
          {busy && <Spinner data-icon="inline-start" />}
          Save changes
        </Button>
      </div>
    </form>
  );
}
