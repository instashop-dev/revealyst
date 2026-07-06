"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Link2 } from "lucide-react";
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

type PersonRef = { id: string; pseudonym: string; displayName: string | null };

const SELECT_CLASS =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30";

async function post(body: unknown): Promise<Response> {
  return fetch("/api/reconcile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function ReconcileSubjectDialog({
  subject,
  people,
  teams,
}: {
  subject: { subjectId: string; label: string; vendor: string };
  people: PersonRef[];
  teams: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"link" | "create">(
    people.length > 0 ? "link" : "create",
  );
  const [personId, setPersonId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [teamId, setTeamId] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() {
    setMode(people.length > 0 ? "link" : "create");
    setPersonId("");
    setDisplayName("");
    setTeamId("");
  }

  const canSubmit =
    mode === "link" ? personId.length > 0 : displayName.trim().length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      // Resolve the subject to a person (link existing or create new).
      const res =
        mode === "link"
          ? await post({ action: "link", subjectId: subject.subjectId, personId })
          : await post({
              action: "create_and_link",
              subjectId: subject.subjectId,
              displayName: displayName.trim(),
            });
      if (!res.ok) {
        toast.error(`Could not resolve identity (${res.status})`);
        return;
      }
      const resolvedPersonId =
        mode === "link"
          ? personId
          : ((await res.json()) as { personId: string }).personId;

      // Optional manual team assignment in the same flow.
      if (teamId) {
        const teamRes = await post({
          action: "assign_team",
          personId: resolvedPersonId,
          teamId,
        });
        if (!teamRes.ok) {
          toast.error("Identity linked, but team assignment failed");
          setOpen(false);
          router.refresh();
          return;
        }
      }

      toast.success("Identity resolved");
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) reset();
      }}
    >
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Link2 data-icon="inline-start" />
        Reconcile
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resolve to a person</DialogTitle>
          <DialogDescription>
            {subject.label} · {subject.vendor}. Linking records this vendor
            account to a real person — usage stays attributed honestly and is
            never fabricated from account-level data.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <FieldGroup>
            {people.length > 0 ? (
              <Field>
                <FieldLabel>Action</FieldLabel>
                <ToggleGroup
                  value={[mode]}
                  onValueChange={(value) => {
                    const next = value[0];
                    if (next === "link" || next === "create") setMode(next);
                  }}
                  variant="outline"
                >
                  <ToggleGroupItem value="link">Link existing</ToggleGroupItem>
                  <ToggleGroupItem value="create">Create person</ToggleGroupItem>
                </ToggleGroup>
              </Field>
            ) : null}

            {mode === "link" ? (
              <Field>
                <FieldLabel htmlFor="reconcile-person">Person</FieldLabel>
                {/* biome-ignore lint/a11y/noLabelWithoutControl: label is bound via htmlFor/id */}
                <select
                  id="reconcile-person"
                  className={cn(SELECT_CLASS)}
                  value={personId}
                  onChange={(e) => setPersonId(e.target.value)}
                >
                  <option value="">Select a person…</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.pseudonym}
                      {p.displayName ? ` · ${p.displayName}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field>
                <FieldLabel htmlFor="reconcile-name">Person name</FieldLabel>
                <Input
                  id="reconcile-name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Jordan Rivera"
                  autoFocus
                />
                <FieldDescription>
                  Creates a new tracked person, then links this account to them.
                </FieldDescription>
              </Field>
            )}

            {teams.length > 0 ? (
              <Field>
                <FieldLabel htmlFor="reconcile-team">
                  Assign to team (optional)
                </FieldLabel>
                <select
                  id="reconcile-team"
                  className={cn(SELECT_CLASS)}
                  value={teamId}
                  onChange={(e) => setTeamId(e.target.value)}
                >
                  <option value="">No team</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={busy || !canSubmit}>
              {busy && <Spinner data-icon="inline-start" />}
              Resolve
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
