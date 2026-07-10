"use client";

import { useRouter } from "next/navigation";
import { type KeyboardEvent, useRef, useState } from "react";
import { Check, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { VisibilityMode } from "@/lib/visibility";
import {
  loosensPrivacy,
  VISIBILITY_MODE_INFO,
  VISIBILITY_MODES,
  VISIBILITY_READINESS_STEPS,
} from "@/lib/visibility-playbook";

/**
 * Org visibility-mode control (Spec V3 §9.1, ADR 0018). The single most
 * privacy-sensitive mutation in the product. Each mode's "what this reveals"
 * copy is shown BEFORE the admin flips it (playbook-at-the-toggle); switching
 * AWAY from team-only (private → managed/full) opens the visibility-readiness
 * playbook — the consent / works-council / DPIA framing — as a confirmation
 * step before the change commits. Tightening back to Private never asks.
 */
export function VisibilityModeControl({ current }: { current: VisibilityMode }) {
  const router = useRouter();
  const [applied, setApplied] = useState<VisibilityMode>(current);
  const [busy, setBusy] = useState(false);
  // The mode awaiting readiness confirmation (loosening switch), or null.
  const [pending, setPending] = useState<VisibilityMode | null>(null);

  async function commit(mode: VisibilityMode) {
    if (mode === applied) return;
    setBusy(true);
    const previous = applied;
    setApplied(mode); // optimistic
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibilityMode: mode }),
      });
      if (!res.ok) {
        setApplied(previous);
        toast.error(
          res.status === 403
            ? "Only workspace admins can change visibility"
            : "Could not change visibility mode",
        );
        return;
      }
      toast.success(`Visibility set to ${VISIBILITY_MODE_INFO[mode].label}`);
      router.refresh();
    } catch {
      setApplied(previous);
      toast.error("Network error — visibility not changed");
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  function choose(mode: VisibilityMode) {
    if (mode === applied || busy || pending !== null) return;
    // Switching away from team-only reveals real identities — surface the
    // readiness playbook first. Tightening (→ private) commits immediately.
    if (loosensPrivacy(applied, mode)) {
      setPending(mode);
    } else {
      void commit(mode);
    }
  }

  // Roving-tabindex refs (WAI-ARIA radio group): only the checked option is in
  // the tab order; Arrow keys move focus + selection between options.
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function onOptionKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let dir = 0;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") dir = 1;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") dir = -1;
    else return;
    event.preventDefault();
    const count = VISIBILITY_MODES.length;
    const nextIndex = (index + dir + count) % count;
    optionRefs.current[nextIndex]?.focus();
    // APG radio semantics: selection follows focus. Here choosing may open the
    // privacy-readiness dialog (loosening) or commit immediately (tightening) —
    // the same effect as a click, which is the documented behavior (see test).
    choose(VISIBILITY_MODES[nextIndex]);
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3" role="radiogroup" aria-label="Visibility mode">
        {VISIBILITY_MODES.map((mode, index) => {
          const info = VISIBILITY_MODE_INFO[mode];
          const active = applied === mode;
          return (
            <li key={mode}>
              <button
                type="button"
                role="radio"
                aria-checked={active}
                // Roving tabindex: the checked option is the single tab stop;
                // the rest are reached via Arrow keys.
                tabIndex={active ? 0 : -1}
                ref={(el) => {
                  optionRefs.current[index] = el;
                }}
                onKeyDown={(e) => onOptionKeyDown(e, index)}
                // Also disabled while the readiness dialog is pending, so a
                // click can't re-enter choose() even if the dialog were ever
                // rendered non-modal.
                disabled={busy || pending !== null}
                onClick={() => choose(mode)}
                className={`flex w-full flex-col gap-1 rounded-lg border p-4 text-left transition-colors disabled:opacity-60 ${
                  active
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:bg-muted/50"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="font-medium">{info.label}</span>
                  {info.euSafe && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      <ShieldCheck className="size-3" /> Default
                    </span>
                  )}
                  {active && (
                    <Check className="ml-auto size-4 shrink-0 text-primary" />
                  )}
                </span>
                <span className="text-sm text-muted-foreground">
                  {info.tagline}
                </span>
                <span className="mt-1 text-xs text-muted-foreground">
                  {info.reveals}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPending(null);
            // The option we arrowed to became disabled while the dialog was
            // open, so Base UI can't restore focus to it on close — return
            // focus to the checked radio (re-enabled on the next render) so
            // keyboard focus never falls to document.body.
            const idx = VISIBILITY_MODES.indexOf(applied);
            requestAnimationFrame(() => optionRefs.current[idx]?.focus());
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert className="size-5 text-amber-600" />
              Before you reveal real names
            </DialogTitle>
            <DialogDescription>
              Switching to{" "}
              <span className="font-medium">
                {pending ? VISIBILITY_MODE_INFO[pending].label : ""}
              </span>{" "}
              makes individual identities visible. This is a
              privacy-material change — work through this readiness checklist
              first.
            </DialogDescription>
          </DialogHeader>
          <Alert>
            <AlertTitle>Visibility-readiness checklist</AlertTitle>
            <AlertDescription>
              <ol className="ml-4 list-decimal space-y-2 text-sm">
                {VISIBILITY_READINESS_STEPS.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p className="mt-3 text-xs text-muted-foreground">
                This is onboarding guidance, not legal advice. The change is
                audited and reversible — you can return to Private at any time.
              </p>
            </AlertDescription>
          </Alert>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() => pending && commit(pending)}
            >
              {busy && <Spinner data-icon="inline-start" />}
              I understand — reveal names
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
