"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { inputClassName } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

export type ManagerOption = { userId: string; label: string };

/**
 * Inline team → manager control (D-TCI-3, ADR 0044). Lists the team's current
 * managers as removable chips and offers a picker of workspace members to add
 * one. Each change fires immediately (POST to add, DELETE to remove) — no
 * separate save step, mirroring the role picker. Admin-only at the route; the
 * Settings page only renders this for admins. Making someone a manager does not
 * reveal any per-person data — it records who is responsible for the team.
 */
export function TeamManagerControl({
  teamId,
  teamName,
  current,
  members,
}: {
  teamId: string;
  teamName: string;
  /** User ids that currently manage this team. */
  current: string[];
  /** Every workspace member — the add-manager options. */
  members: ManagerOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [managerIds, setManagerIds] = useState<string[]>(current);

  const labelFor = (userId: string) =>
    members.find((m) => m.userId === userId)?.label ?? userId;
  const addable = members.filter((m) => !managerIds.includes(m.userId));

  async function mutate(userId: string, action: "add" | "remove") {
    const previous = managerIds;
    setManagerIds(
      action === "add"
        ? [...managerIds, userId]
        : managerIds.filter((id) => id !== userId),
    );
    setBusy(true);
    try {
      const res = await fetch(
        `/api/teams/${encodeURIComponent(teamId)}/managers`,
        {
          method: action === "add" ? "POST" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        },
      );
      if (!res.ok) {
        setManagerIds(previous);
        toast.error(
          res.status === 403
            ? "Only workspace admins can set managers"
            : "Could not update this team's managers",
        );
        return;
      }
      toast.success(action === "add" ? "Manager added" : "Manager removed");
      router.refresh();
    } catch {
      setManagerIds(previous);
      toast.error("Network error — managers not changed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {managerIds.length > 0 ? (
        <div className="flex flex-wrap justify-end gap-1.5">
          {managerIds.map((userId) => (
            <Badge key={userId} variant="secondary" className="gap-1">
              {labelFor(userId)}
              <button
                type="button"
                aria-label={`Remove ${labelFor(userId)} as a manager of ${teamName}`}
                className="rounded-full outline-none hover:opacity-70 focus-visible:ring-2"
                disabled={busy}
                onClick={() => mutate(userId, "remove")}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : (
        <span className="text-sm text-muted-foreground">No managers</span>
      )}
      <div className="flex items-center gap-2">
        {busy ? <Spinner /> : null}
        {/* biome-ignore lint/a11y/noLabelWithoutControl: label is bound via aria-label */}
        <select
          aria-label={`Add a manager to ${teamName}`}
          className={inputClassName}
          value=""
          disabled={busy || addable.length === 0}
          onChange={(e) => {
            if (e.target.value) mutate(e.target.value, "add");
          }}
        >
          <option value="">
            {addable.length === 0 ? "All members manage" : "Add manager…"}
          </option>
          {addable.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
