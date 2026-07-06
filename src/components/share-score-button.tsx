"use client";

import { useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";
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

// Opt-in public share link (W2-H PR5, ADR 0008). Creates a link for the
// signed-in person's featured score and shows the public URL once. The
// public_label is user-chosen here — it's what appears on the public card,
// deliberately decoupled from the internal pseudonym.
export function ShareScoreButton({
  personId,
  scoreSlug,
  defaultLabel,
}: {
  personId: string;
  scoreSlug: string;
  defaultLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(defaultLabel);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId, scoreSlug, publicLabel: label }),
      });
      if (!res.ok) {
        toast.error(`Could not create link (${res.status})`);
        return;
      }
      const { token } = (await res.json()) as { token: string };
      setUrl(`${window.location.origin}/s/${token}`);
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Insecure context / permission denied — the URL is still visible in
      // the read-only field for manual copy.
      toast.error("Couldn't copy — select the link and copy it manually");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          // Reset for the next open — a fresh link each time.
          setUrl(null);
          setCopied(false);
          setLabel(defaultLabel);
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Share2 data-icon="inline-start" />
        Share
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share your score</DialogTitle>
          <DialogDescription>
            Creates a public link showing only the label you choose and this
            score — no email, no other data. You can revoke it later.
          </DialogDescription>
        </DialogHeader>
        {url ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Input readOnly value={url} className="font-mono text-xs" />
              <Button type="button" variant="outline" size="icon" onClick={copy}>
                {copied ? <Check /> : <Copy />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Anyone with this link can see the card. Revoke it from your
              connections if you change your mind.
            </p>
          </div>
        ) : (
          <form onSubmit={create} className="flex flex-col gap-4">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="share-label">Public label</FieldLabel>
                <Input
                  id="share-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={80}
                  required
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Shown on the public card — a name or handle you&apos;re happy
                  to publish.
                </p>
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="submit" disabled={busy || label.trim().length === 0}>
                {busy && <Spinner data-icon="inline-start" />}
                Create link
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
