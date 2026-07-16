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
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

// One enrolled desktop device (Desktop Agent T2.4). Client leaf: rename (PATCH)
// and revoke (POST) hit the self-owned device routes; ownership is re-checked
// server-side. The relative-time labels are computed on the server and passed
// in, so there is no client clock and no hydration drift.

export type DeviceRowProps = {
  id: string;
  name: string;
  platform: string | null;
  agentVersion: string | null;
  lastHeartbeatLabel: string | null;
  enrolledLabel: string;
  revoked: boolean;
};

export function DeviceRow({
  id,
  name: initialName,
  platform,
  agentVersion,
  lastHeartbeatLabel,
  enrolledLabel,
  revoked,
}: DeviceRowProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const trimmed = name.trim();
  const unchanged = trimmed === initialName.trim();

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    if (unchanged || trimmed.length === 0) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/desktop/devices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        toast.error("Could not rename this device");
        return;
      }
      toast.success("Device renamed");
      router.refresh();
    } catch {
      toast.error("Network error — device not renamed");
    } finally {
      setSaving(false);
    }
  }

  async function revoke() {
    setRevoking(true);
    try {
      const res = await fetch(`/api/desktop/devices/${id}/revoke`, {
        method: "POST",
      });
      if (!res.ok) {
        toast.error("Could not remove this device");
        return;
      }
      toast.success("Device removed");
      setConfirmOpen(false);
      router.refresh();
    } catch {
      toast.error("Network error — device not removed");
    } finally {
      setRevoking(false);
    }
  }

  const platformLabel =
    platform === "macos"
      ? "Mac"
      : platform === "windows"
        ? "Windows"
        : platform;

  const meta = [
    platformLabel,
    agentVersion ? `App ${agentVersion}` : null,
    lastHeartbeatLabel ? `Last seen ${lastHeartbeatLabel}` : "Not seen yet",
    `Added ${enrolledLabel}`,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">{meta.join(" · ")}</p>
        {revoked ? (
          <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            Removed
          </span>
        ) : null}
      </div>

      {revoked ? (
        <p className="text-sm font-medium">{initialName}</p>
      ) : (
        <form onSubmit={rename} className="flex items-end gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <label htmlFor={`device-name-${id}`} className="text-sm font-medium">
              Device name
            </label>
            <Input
              id={`device-name-${id}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={1}
              maxLength={80}
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            disabled={saving || unchanged || trimmed.length === 0}
          >
            {saving && <Spinner data-icon="inline-start" />}
            Save
          </Button>
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogTrigger render={<Button type="button" variant="destructive" />}>
              Remove
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Remove this device?</DialogTitle>
                <DialogDescription>
                  &ldquo;{initialName}&rdquo; will stop sending data and will be
                  signed out. To use it again, set it up from scratch on that
                  computer. Your other devices are not affected.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={revoking}
                  onClick={revoke}
                >
                  {revoking && <Spinner data-icon="inline-start" />}
                  Remove device
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </form>
      )}
    </div>
  );
}
