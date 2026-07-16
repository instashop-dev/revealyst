"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Small copy-to-clipboard affordance (e.g. the workspace org id). Shows a
 * momentary check on success; falls back to an error toast if the clipboard
 * API is unavailable or denied.
 */
export function ClipboardButton({
  value,
  label,
  successMessage = "Copied",
}: {
  value: string;
  /** Accessible label for the icon-only button. */
  label: string;
  successMessage?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(successMessage);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy — copy it manually");
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={copy}
      aria-label={label}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  );
}
