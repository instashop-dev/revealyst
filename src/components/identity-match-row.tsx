"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { ReconcileSubjectDialog } from "@/components/reconcile-subject-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { TableCell, TableRow } from "@/components/ui/table";

type PersonRef = { id: string; pseudonym: string; displayName: string | null };

export type IdentityMatchRowProps = {
  subject: {
    subjectId: string;
    label: string;
    vendor: string;
    kind: string;
    flagged: boolean;
  };
  /** The one evidence line we can honestly show. Comes ONLY from an email
   * match (`email matches <address>`); null when there is no confident signal
   * — we render nothing rather than invent "active on the same days". */
  evidence: string | null;
  /** A one-click email-match suggestion, when the subject uniquely matches a
   * person by email. Null otherwise. */
  proposedMatch: { personId: string; personLabel: string } | null;
  people: PersonRef[];
  teams: { id: string; name: string }[];
};

async function reconcilePost(body: unknown): Promise<Response> {
  return fetch("/api/reconcile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * One row of the "Needs matching" list (extracted from the reconcile page).
 * Shows the account, the honest evidence line, and the actions: accept the
 * email-match suggestion in one click (with an Undo that unlinks), match to
 * someone else via the existing dialog, or explicitly leave it unresolved —
 * the honest default, since we never invent a person.
 */
export function IdentityMatchRow({
  subject,
  evidence,
  proposedMatch,
  people,
  teams,
}: IdentityMatchRowProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function acceptMatch() {
    if (!proposedMatch) return;
    setBusy(true);
    try {
      const res = await reconcilePost({
        action: "link",
        subjectId: subject.subjectId,
        personId: proposedMatch.personId,
      });
      if (!res.ok) {
        toast.error(`Could not match (${res.status})`);
        return;
      }
      // The inverse of link is unlink — offer it as a one-click Undo.
      toast.success(`Matched to ${proposedMatch.personLabel}`, {
        action: {
          label: "Undo",
          onClick: () => void undoMatch(proposedMatch.personId),
        },
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function undoMatch(personId: string) {
    const res = await reconcilePost({
      action: "unlink",
      subjectId: subject.subjectId,
      personId,
    });
    if (!res.ok) {
      toast.error(`Could not undo (${res.status})`);
      return;
    }
    toast.success("Match undone");
    router.refresh();
  }

  return (
    <TableRow>
      <TableCell className="font-medium">
        {subject.label}
        {subject.flagged ? (
          <Badge variant="outline" className="ml-2">
            shared?
          </Badge>
        ) : null}
      </TableCell>
      <TableCell className="text-muted-foreground">{subject.vendor}</TableCell>
      <TableCell className="text-muted-foreground capitalize">
        {subject.kind.replace(/_/g, " ")}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {evidence ?? (
          <span className="text-muted-foreground/70">No automatic match</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          {proposedMatch ? (
            <Button size="sm" onClick={acceptMatch} disabled={busy}>
              {busy ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Check data-icon="inline-start" />
              )}
              Accept
            </Button>
          ) : null}
          <ReconcileSubjectDialog
            subject={{
              subjectId: subject.subjectId,
              label: subject.label,
              vendor: subject.vendor,
            }}
            people={people}
            teams={teams}
            triggerLabel={proposedMatch ? "Someone else" : "Match"}
          />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`More options for ${subject.label}`}
                />
              }
            >
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {/* The honest default: doing nothing keeps this account
                  unresolved — a no-op that just confirms the choice, never
                  invents a person (invariant b). */}
              <DropdownMenuItem
                onClick={() =>
                  toast.success("Left unresolved — we never invent a person.")
                }
              >
                Leave unresolved (default)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  );
}
