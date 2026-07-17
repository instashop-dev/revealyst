"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarClock, NotebookPen, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { inputClassName } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { formatRelativeTime } from "@/lib/format";
import { MANAGER_NOTES_COPY } from "@/lib/manager-capability-copy";

/**
 * The manager per-person NOTES section (D-TCI-7, ADR 0053). Renders ONLY when the
 * page's notes loader returned `ok` (the manager surface is available and the
 * caller manages the person's team); otherwise the page omits it entirely.
 *
 * Read visibility is any current manager of the person's team, so a note shows an
 * author byline; WRITE is the signed-in manager (author derived server-side), and
 * DELETE is author-only (the trash affordance renders only on the caller's own
 * notes — the server enforces it regardless). A save/delete refreshes the server
 * component rather than mutating local state, so the list can never drift from
 * what the authorized read returns.
 */

export type ManagerNoteVM = {
  id: string;
  authorUserId: string;
  /** Resolved on the page from `orgMembersList`; falls back to a neutral label. */
  authorName: string;
  body: string;
  followUpOn: string | null;
  /** ISO string (server Date serialized across the RSC boundary). */
  createdAt: string;
};

export function ManagerNotesSection({
  personId,
  currentUserId,
  notes,
}: {
  personId: string;
  currentUserId: string;
  notes: ManagerNoteVM[];
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [followUpOn, setFollowUpOn] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const canSave = body.trim().length > 0 && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/team/${encodeURIComponent(personId)}/notes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body: body.trim(),
            followUpOn: followUpOn ? followUpOn : null,
          }),
        },
      );
      if (!res.ok) {
        toast.error(MANAGER_NOTES_COPY.saveError);
        return;
      }
      setBody("");
      setFollowUpOn("");
      router.refresh();
    } catch {
      toast.error(MANAGER_NOTES_COPY.saveError);
    } finally {
      setSaving(false);
    }
  }

  async function remove(noteId: string) {
    if (!window.confirm(MANAGER_NOTES_COPY.deleteConfirm)) return;
    setDeletingId(noteId);
    try {
      const res = await fetch(
        `/api/team/${encodeURIComponent(personId)}/notes/${encodeURIComponent(noteId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        toast.error(MANAGER_NOTES_COPY.deleteError);
        return;
      }
      router.refresh();
    } catch {
      toast.error(MANAGER_NOTES_COPY.deleteError);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card>
      <CardHeader className="gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <NotebookPen className="size-4 text-primary" aria-hidden="true" />
          {MANAGER_NOTES_COPY.heading}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {MANAGER_NOTES_COPY.description}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Add-a-note form. */}
        <div className="flex flex-col gap-2">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: label is bound via htmlFor/id */}
          <label htmlFor="manager-note-body" className="sr-only">
            {MANAGER_NOTES_COPY.heading}
          </label>
          <textarea
            id="manager-note-body"
            className={inputClassName}
            style={{ height: "auto", minHeight: "4.5rem" }}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={MANAGER_NOTES_COPY.placeholder}
            rows={3}
            maxLength={4000}
            disabled={saving}
          />
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="manager-note-followup"
                className="text-xs text-muted-foreground"
              >
                {MANAGER_NOTES_COPY.followUpLabel}
              </label>
              <input
                id="manager-note-followup"
                type="date"
                className={inputClassName}
                style={{ width: "auto" }}
                value={followUpOn}
                onChange={(e) => setFollowUpOn(e.target.value)}
                disabled={saving}
              />
            </div>
            <Button type="button" size="sm" onClick={save} disabled={!canSave}>
              {saving ? <Spinner /> : null}
              {MANAGER_NOTES_COPY.addAction}
            </Button>
          </div>
        </div>

        {/* The notes list, newest first (the server already sorts). */}
        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {MANAGER_NOTES_COPY.empty}
          </p>
        ) : (
          <ul className="flex flex-col gap-3 border-t pt-3">
            {notes.map((note) => {
              const isAuthor = note.authorUserId === currentUserId;
              return (
                <li key={note.id} className="flex flex-col gap-1.5">
                  <p className="whitespace-pre-wrap text-sm">{note.body}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      {MANAGER_NOTES_COPY.byline(
                        note.authorName,
                        formatRelativeTime(note.createdAt),
                      )}
                    </span>
                    {note.followUpOn ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-foreground">
                        <CalendarClock className="size-3" aria-hidden="true" />
                        {MANAGER_NOTES_COPY.followUpChip(note.followUpOn)}
                      </span>
                    ) : null}
                    {isAuthor ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="-my-1 h-auto px-1.5 py-0.5 text-xs text-muted-foreground"
                        onClick={() => remove(note.id)}
                        disabled={deletingId === note.id}
                        aria-label={MANAGER_NOTES_COPY.deleteLabel}
                      >
                        {deletingId === note.id ? (
                          <Spinner />
                        ) : (
                          <Trash2 className="size-3" aria-hidden="true" />
                        )}
                        {MANAGER_NOTES_COPY.deleteAction}
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
