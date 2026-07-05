"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";

export function ManageTeamMembersDialog({
  teamId,
  teamName,
  memberIds,
  people,
}: {
  teamId: string;
  teamName: string;
  memberIds: string[];
  people: { id: string; pseudonym: string; displayName: string | null }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(memberIds));
  const [busy, setBusy] = useState(false);

  function toggle(personId: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(personId);
      } else {
        next.delete(personId);
      }
      return next;
    });
  }

  async function save() {
    setBusy(true);
    const res = await fetch(`/api/teams/${teamId}/members`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personIds: [...selected] }),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(`Could not update members (${res.status})`);
      return;
    }
    toast.success(`"${teamName}" members updated`);
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setSelected(new Set(memberIds));
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        Manage members
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Members of {teamName}</DialogTitle>
          <DialogDescription>
            Tracked people in this team. Saving replaces the member set.
          </DialogDescription>
        </DialogHeader>
        {people.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tracked people in this workspace yet — people appear when
            connectors resolve identities.
          </p>
        ) : (
          <ScrollArea className="max-h-64">
            <div className="flex flex-col gap-3">
              {people.map((person) => (
                <div key={person.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`member-${teamId}-${person.id}`}
                    checked={selected.has(person.id)}
                    onCheckedChange={(checked) =>
                      toggle(person.id, checked === true)
                    }
                  />
                  <Label htmlFor={`member-${teamId}-${person.id}`}>
                    {person.pseudonym}
                    {person.displayName ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {person.displayName}
                      </span>
                    ) : null}
                  </Label>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
        <DialogFooter>
          <Button onClick={save} disabled={busy || people.length === 0}>
            {busy && <Spinner data-icon="inline-start" />}
            Save members
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
