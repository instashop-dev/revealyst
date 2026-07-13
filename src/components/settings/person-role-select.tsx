"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { inputClassName } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

export type RoleOption = { slug: string; label: string };

/**
 * Inline person → engineering-role control (W6-B, ADR 0030). Fires on change,
 * no separate save step (a single low-risk pick, like the platform-role
 * select). PUTs the frozen `roleAssignmentSet` contract; the empty option
 * unassigns (sends `roleSlug: null`). Admin-only at the route; the Settings
 * page only renders this card for admins.
 */
export function PersonRoleSelect({
  personId,
  personLabel,
  current,
  roles,
}: {
  personId: string;
  personLabel: string;
  current: string | null;
  roles: RoleOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState<string>(current ?? "");

  async function onChange(next: string) {
    if (next === value) return;
    const previous = value;
    setValue(next); // optimistic
    setBusy(true);
    try {
      const res = await fetch(
        `/api/people/${encodeURIComponent(personId)}/role`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roleSlug: next === "" ? null : next }),
        },
      );
      if (!res.ok) {
        setValue(previous);
        toast.error(
          res.status === 403
            ? "Only workspace admins can set roles"
            : "Could not set this person's role",
        );
        return;
      }
      toast.success(next === "" ? "Role cleared" : "Role updated");
      router.refresh();
    } catch {
      setValue(previous);
      toast.error("Network error — role not changed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {busy ? <Spinner /> : null}
      {/* biome-ignore lint/a11y/noLabelWithoutControl: label is bound via aria-label */}
      <select
        aria-label={`Role for ${personLabel}`}
        className={inputClassName}
        value={value}
        disabled={busy}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Unassigned</option>
        {roles.map((role) => (
          <option key={role.slug} value={role.slug}>
            {role.label}
          </option>
        ))}
      </select>
    </div>
  );
}
