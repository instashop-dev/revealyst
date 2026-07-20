"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { inputClassName } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { formatRelativeTime } from "@/lib/format";
import { TEAM_OVERVIEW_COPY } from "@/lib/team-overview-copy";

const COPY = TEAM_OVERVIEW_COPY.initiatives;

type DecisionEvent = "launched" | "noted" | "completed" | "stopped";

type DecisionVM = {
  id: string;
  event: DecisionEvent;
  note: string | null;
  /** ISO string (server Date serialized across the fetch boundary). */
  createdAt: string;
  /** Resolved server-side from org members; a neutral fallback if the author left. */
  authorName: string;
};

/**
 * The manager DECISION LOG for one initiative (TMD P3 tail, T3.2), embedded in
 * the review drawer. It fetches the append-only who/why trail on open and lets
 * the owner/admin add a note. Owner-OR-admin is enforced server-side (the GET
 * 403s otherwise, leaving the log absent). The trail refreshes from the server
 * after a write, so it can never drift from what the authorized read returns.
 */
export function InitiativeDecisionLog({
  initiativeId,
  open,
}: {
  initiativeId: string;
  open: boolean;
}) {
  const [decisions, setDecisions] = useState<DecisionVM[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/initiatives/${encodeURIComponent(initiativeId)}/decisions`,
      );
      if (!res.ok) {
        // A 403 (a viewer who isn't the owner/an admin) or any error hides the
        // log rather than spinning on "Loading…" forever — the server owns the
        // authorization; this just keeps the UI from getting stuck.
        setFailed(true);
        return;
      }
      const data = (await res.json()) as { decisions: DecisionVM[] };
      setDecisions(data.decisions);
    } catch {
      setFailed(true);
    }
  }, [initiativeId]);

  useEffect(() => {
    if (!open) return;
    setDecisions(null);
    setFailed(false);
    void load();
  }, [open, load]);

  // Couldn't load (unauthorized or a transient error): render nothing — the
  // review action above is unaffected.
  if (failed) return null;

  const canSave = note.trim().length > 0 && !saving;

  async function addNote() {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/initiatives/${encodeURIComponent(initiativeId)}/decisions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: note.trim() }),
        },
      );
      if (!res.ok) {
        toast.error(COPY.decisionAddError);
        return;
      }
      setNote("");
      await load();
    } catch {
      toast.error(COPY.decisionAddError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-medium">{COPY.decisionsHeading}</h3>
        <p className="text-xs text-muted-foreground">{COPY.decisionsLead}</p>
      </div>

      {/* The trail — chronological (the server orders oldest-first). */}
      {decisions === null ? (
        <p className="text-sm text-muted-foreground">{COPY.decisionsLoading}</p>
      ) : decisions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{COPY.decisionsEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {decisions.map((d) => (
            <li key={d.id} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                  {COPY.decisionEvent[d.event]}
                </span>
                <span className="text-xs text-muted-foreground">
                  {COPY.decisionBy(d.authorName)} ·{" "}
                  {formatRelativeTime(d.createdAt)}
                </span>
              </div>
              {d.note ? (
                <p className="whitespace-pre-wrap text-sm">{d.note}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {/* Add a note to the log. */}
      <div className="flex flex-col gap-2">
        {/* biome-ignore lint/a11y/noLabelWithoutControl: label is bound via htmlFor/id */}
        <label htmlFor="initiative-decision-note" className="sr-only">
          {COPY.decisionAdd}
        </label>
        <textarea
          id="initiative-decision-note"
          className={inputClassName}
          style={{ height: "auto", minHeight: "3.5rem" }}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={COPY.decisionNotePlaceholder}
          rows={2}
          maxLength={1000}
          disabled={saving}
        />
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={addNote} disabled={!canSave}>
            {saving ? <Spinner /> : null}
            {COPY.decisionAdd}
          </Button>
        </div>
      </div>
    </div>
  );
}
