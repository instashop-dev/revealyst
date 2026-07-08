"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertCircle, KeyRound, Plus } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertTitle } from "@/components/ui/alert";
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { connectApiKeyVendor } from "@/lib/connect-vendor";
import { KEY_VENDORS, type KeyVendor } from "@/lib/vendor-connect-meta";

/**
 * "Add connection" for the connections page: pick a key-based vendor, name
 * it, paste the key — the shared connect flow (create → validate-on-save →
 * best-effort poll). Agent (device-token) pairing stays in onboarding. Open
 * to all members — create/credential/poll are not admin-gated. The form
 * lives INSIDE DialogContent, which unmounts on close, so every open starts
 * fresh and a mid-flight close can't leak state into the next open.
 */
export function AddConnectionDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus data-icon="inline-start" />
        Add connection
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add connection</DialogTitle>
          <DialogDescription>
            Keys are encrypted at rest and never displayed again.
          </DialogDescription>
        </DialogHeader>
        <AddConnectionForm
          onRowCreated={() => router.refresh()}
          onSuccess={(label) => {
            toast.success(`${label} connected`);
            setOpen(false);
            router.refresh();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function AddConnectionForm({
  onRowCreated,
  onSuccess,
}: {
  onRowCreated: () => void;
  onSuccess: (vendorLabel: string) => void;
}) {
  const [vendor, setVendor] = useState<KeyVendor>(KEY_VENDORS[0]);
  // null = "follow the vendor" (`My ${label}`); set once the user types.
  const [customName, setCustomName] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A prior attempt's row — reused on retry so the credential upsert
  // overwrites instead of orphaning a duplicate.
  const [createdConnectionId, setCreatedConnectionId] = useState<
    string | null
  >(null);

  const displayName = customName ?? `My ${vendor.label}`;

  function pickVendor(next: KeyVendor) {
    setVendor(next);
    // A row created for the previous vendor must not receive this vendor's
    // key — a fresh submit creates a fresh row. The abandoned pending row is
    // already visible in the list (onRowCreated refreshed it) and an admin
    // can delete it.
    setCreatedConnectionId(null);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await connectApiKeyVendor({
        vendor,
        displayName,
        apiKey,
        existingConnectionId: createdConnectionId,
        onCreated: (id) => {
          setCreatedConnectionId(id);
          onRowCreated();
        },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSuccess(vendor.label);
    } catch {
      setError("Network error — check your connection and try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <FieldGroup>
        <Field>
          <FieldLabel>Vendor</FieldLabel>
          <ToggleGroup
            value={[vendor.vendor]}
            onValueChange={(value) => {
              const next = KEY_VENDORS.find((v) => v.vendor === value[0]);
              if (next) pickVendor(next);
            }}
            variant="outline"
          >
            {KEY_VENDORS.map((v) => (
              <ToggleGroupItem key={v.vendor} value={v.vendor}>
                {v.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <FieldDescription>{vendor.blurb}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="add-connection-name">Name</FieldLabel>
          <Input
            id="add-connection-name"
            value={displayName}
            onChange={(e) => setCustomName(e.target.value)}
            required
            disabled={createdConnectionId !== null}
          />
          {createdConnectionId !== null && (
            <FieldDescription>
              Name is set at creation — an admin can rename it from the row
              menu.
            </FieldDescription>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor="add-connection-key">
            <KeyRound data-icon="inline-start" />
            API key
          </FieldLabel>
          <Input
            id="add-connection-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={vendor.placeholder}
            autoComplete="off"
            required
          />
          <FieldDescription>{vendor.keyHint}</FieldDescription>
        </Field>
      </FieldGroup>
      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      )}
      <DialogFooter>
        <Button
          type="submit"
          disabled={busy || apiKey.length === 0 || displayName.length === 0}
        >
          {busy && <Spinner data-icon="inline-start" />}
          Connect {vendor.label}
        </Button>
      </DialogFooter>
    </form>
  );
}
