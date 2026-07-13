"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AlertCircle,
  CalendarClock,
  KeyRound,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Trash2,
} from "lucide-react";
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
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { errorText, jsonRequest, postJson } from "@/lib/client-fetch";
import { RENEWAL_DATE_HINT } from "@/lib/connections-copy";
import { KEY_VENDORS } from "@/lib/vendor-connect-meta";

type ConnectionSummary = {
  id: string;
  vendor: string;
  displayName: string;
  status: "pending" | "active" | "paused" | "error";
  /** User-entered renewal date ("YYYY-MM-DD") or null — no vendor reports it. */
  renewalDate: string | null;
};

/**
 * Per-row manage menu (ADR 0013) — rendered only for admins (PATCH/DELETE
 * are admin-only). Pause/resume are direct menu actions; Edit opens a dialog
 * for rename + key replacement; Delete confirms with honest copy about what
 * is destroyed. Dialogs are conditionally mounted so every open starts from
 * the row's CURRENT state — no stale names, keys, or errors.
 */
export function ConnectionRowActions({
  connection,
}: {
  connection: ConnectionSummary;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function setPaused(paused: boolean) {
    setBusy(true);
    try {
      const res = await jsonRequest(
        "PATCH",
        `/api/connections/${connection.id}`,
        { status: paused ? "paused" : "active" },
      );
      if (!res.ok) {
        toast.error(
          errorText(
            res.payload,
            `Could not ${paused ? "pause" : "resume"} (${res.status})`,
          ),
        );
        return;
      }
      toast.success(
        paused
          ? `${connection.displayName} paused — polling skips it until resumed`
          : `${connection.displayName} resumed`,
      );
      router.refresh();
    } catch {
      toast.error("Network error — check your connection and try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Manage ${connection.displayName}`}
            />
          }
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            <Pencil data-icon="inline-start" />
            Edit
          </DropdownMenuItem>
          {connection.status === "paused" ? (
            <DropdownMenuItem disabled={busy} onClick={() => setPaused(false)}>
              <Play data-icon="inline-start" />
              Resume polling
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled={busy} onClick={() => setPaused(true)}>
              <Pause data-icon="inline-start" />
              Pause polling
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 data-icon="inline-start" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {editOpen && (
        <EditConnectionDialog
          connection={connection}
          onOpenChange={setEditOpen}
        />
      )}
      {deleteOpen && (
        <DeleteConnectionDialog
          connection={connection}
          onOpenChange={setDeleteOpen}
        />
      )}
    </>
  );
}

function EditConnectionDialog({
  connection,
  onOpenChange,
}: {
  connection: ConnectionSummary;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(connection.displayName);
  const [apiKey, setApiKey] = useState("");
  // The date <input> uses "" for empty; the stored value is null.
  const [renewalDate, setRenewalDate] = useState(connection.renewalDate ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyVendor = KEY_VENDORS.find((v) => v.vendor === connection.vendor);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // The server may change state even when a later step fails (rename
    // applied, or validate-on-save marking the row errored after a rejected
    // key) — refresh whenever anything was attempted past this point.
    let mutated = false;
    try {
      const renaming = name !== connection.displayName && name.length > 0;
      // "" in the input means "no date"; PATCH sends null to clear it. Only
      // send when it actually changed from the stored value.
      const nextRenewal = renewalDate === "" ? null : renewalDate;
      const renewalChanged = nextRenewal !== (connection.renewalDate ?? null);
      // One PATCH carries whichever connection fields changed.
      const patch: {
        displayName?: string;
        renewalDate?: string | null;
      } = {};
      if (renaming) patch.displayName = name;
      if (renewalChanged) patch.renewalDate = nextRenewal;
      if (Object.keys(patch).length > 0) {
        const res = await jsonRequest(
          "PATCH",
          `/api/connections/${connection.id}`,
          patch,
        );
        if (!res.ok) {
          setError(errorText(res.payload, `Update failed (${res.status})`));
          return;
        }
        mutated = true;
      }
      if (keyVendor && apiKey.length > 0) {
        // The credential store is durable even when validation then rejects
        // the key (write-only upsert), so this counts as mutated either way.
        mutated = true;
        const cred = await postJson(
          `/api/connections/${connection.id}/credential`,
          { kind: "api_key", value: apiKey },
        );
        if (!cred.ok) {
          setError(errorText(cred.payload, "That key was rejected"));
          return;
        }
      }
      if (!mutated) {
        onOpenChange(false);
        return; // nothing to do — don't toast a change that didn't happen
      }
      toast.success(`${name} updated`);
      onOpenChange(false);
    } catch {
      setError("Network error — check your connection and try again");
    } finally {
      setBusy(false);
      if (mutated) router.refresh();
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit connection</DialogTitle>
          <DialogDescription>
            Rename the connection, replace its API key, or set a renewal date.
            Keys are encrypted at rest and never displayed again.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="flex flex-col gap-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`edit-name-${connection.id}`}>
                Name
              </FieldLabel>
              <Input
                id={`edit-name-${connection.id}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </Field>
            {keyVendor && (
              <Field>
                <FieldLabel htmlFor={`edit-key-${connection.id}`}>
                  <KeyRound data-icon="inline-start" />
                  Replace API key
                </FieldLabel>
                <Input
                  id={`edit-key-${connection.id}`}
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={keyVendor.placeholder}
                  autoComplete="off"
                />
                <FieldDescription>
                  Leave blank to keep the current key. {keyVendor.keyHint}
                </FieldDescription>
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor={`edit-renewal-${connection.id}`}>
                <CalendarClock data-icon="inline-start" />
                Renewal date
              </FieldLabel>
              <Input
                id={`edit-renewal-${connection.id}`}
                type="date"
                value={renewalDate}
                onChange={(e) => setRenewalDate(e.target.value)}
              />
              {/* Honesty (invariant b): the date is user-entered — no vendor
                  reports renewal dates, so we never imply we know or verified
                  it. Drives the T-30 / T-7 reminder emails to admins. */}
              <FieldDescription>
                {RENEWAL_DATE_HINT} Clear the field to stop reminders.
              </FieldDescription>
            </Field>
          </FieldGroup>
          {error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>{error}</AlertTitle>
            </Alert>
          )}
          <DialogFooter>
            <Button type="submit" disabled={busy || name.length === 0}>
              {busy && <Spinner data-icon="inline-start" />}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteConnectionDialog({
  connection,
  onOpenChange,
}: {
  connection: ConnectionSummary;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function confirmDelete() {
    setBusy(true);
    try {
      const res = await jsonRequest(
        "DELETE",
        `/api/connections/${connection.id}`,
      );
      if (!res.ok) {
        toast.error(errorText(res.payload, `Delete failed (${res.status})`));
        return;
      }
      toast.success(`${connection.displayName} deleted`);
      onOpenChange(false);
      router.refresh();
    } catch {
      toast.error("Network error — check your connection and try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {connection.displayName}?</DialogTitle>
          {/* Honest destruction copy (invariant b): usage records ARE
              removed; people profiles are NOT (they have no connection FK) —
              never overclaim either way. */}
          <DialogDescription>
            This permanently removes the stored credential, the vendor
            accounts this connection discovered, raw payloads, sync history,
            and the usage records it ingested. People profiles remain; scores
            recompute without this source. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirmDelete} disabled={busy}>
            {busy && <Spinner data-icon="inline-start" />}
            Delete connection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
