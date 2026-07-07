"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Share2, Trash2 } from "lucide-react";
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
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";

type ShareLinkRow = {
  id: string;
  scoreSlug: string;
  publicLabel: string;
  createdAt: string;
};

// Opt-in public share link (W2-H PR5, ADR 0008). Creates a link for the
// signed-in person's featured score and shows the public URL once. The
// public_label is user-chosen here — it's what appears on the public card,
// deliberately decoupled from the internal pseudonym. Active links are
// listed with a revoke button (tombstone — the URL 404s immediately);
// plaintext tokens are never stored, so existing links show metadata only.
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
  const [urlLinkId, setUrlLinkId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [links, setLinks] = useState<ShareLinkRow[] | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const refreshLinks = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/share?personId=${encodeURIComponent(personId)}`,
      );
      if (!res.ok) return; // list is best-effort chrome, not the main flow
      const { links } = (await res.json()) as { links: ShareLinkRow[] };
      setLinks(links);
    } catch {
      // Network hiccup — leave the list as-is.
    }
  }, [personId]);

  useEffect(() => {
    if (open) {
      void refreshLinks();
    }
  }, [open, refreshLinks]);

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
      const { token, id } = (await res.json()) as {
        token: string;
        id: string;
      };
      setUrl(`${window.location.origin}/s/${token}`);
      setUrlLinkId(id);
      void refreshLinks();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setRevoking(id);
    try {
      const res = await fetch(`/api/share/${id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error(`Could not revoke link (${res.status})`);
        return;
      }
      toast.success("Link revoked — the URL now shows nothing");
      setLinks((prev) => prev?.filter((l) => l.id !== id) ?? prev);
      if (id === urlLinkId) {
        // The just-created URL panel would otherwise keep urging the user to
        // copy a link that now 404s.
        setUrl(null);
        setUrlLinkId(null);
      }
    } catch {
      toast.error("Network error — please try again");
    } finally {
      // Conditional clear: a faster earlier revoke settling must not wipe
      // the spinner of one still in flight.
      setRevoking((prev) => (prev === id ? null : prev));
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
          setUrlLinkId(null);
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
            score — no email, no other data. Revoke it here any time.
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
              Anyone with this link can see the card. This is the only time
              the URL is shown — copy it now. You can revoke it below whenever
              you change your mind.
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
        {links && links.length > 0 ? (
          <div className="flex flex-col gap-2">
            <Separator />
            <p className="text-xs font-medium text-muted-foreground">
              Active links
            </p>
            <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
              {links.map((l) => (
                <li
                  key={l.id}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="truncate">
                    {l.publicLabel}
                    <span className="text-muted-foreground">
                      {" "}
                      · {l.scoreSlug} ·{" "}
                      {new Date(l.createdAt).toLocaleDateString()}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => revoke(l.id)}
                    disabled={revoking === l.id}
                  >
                    {revoking === l.id ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <Trash2 data-icon="inline-start" />
                    )}
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
