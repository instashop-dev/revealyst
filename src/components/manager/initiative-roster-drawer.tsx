"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { ResponsiveSheetContent } from "@/components/responsive-sheet-content";
import { TEAM_OVERVIEW_COPY } from "@/lib/team-overview-copy";

const COPY = TEAM_OVERVIEW_COPY.initiatives;

type RosterPerson = { personId: string; label: string };
type RosterResponse = { participants: RosterPerson[]; candidates: RosterPerson[] };

/**
 * The named-participant roster drawer (TMD P2c, ADR 0062). Opens ONLY for the
 * initiative's owner in managed/full mode (gated by the caller). Fetches the
 * named roster + the owner's managed candidates from the manager-authorized
 * `/api/initiatives/:id/participants` endpoint, and adds/removes people. A
 * change `router.refresh()`es so the card's count stays in sync.
 */
export function InitiativeRosterDrawer({
  initiativeId,
  initiativeTitle,
  open,
  onOpenChange,
}: {
  initiativeId: string;
  initiativeTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<RosterResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setData(null);
    fetch(`/api/initiatives/${encodeURIComponent(initiativeId)}/participants`)
      .then(async (res) => {
        if (!res.ok) throw new Error("load failed");
        return (await res.json()) as RosterResponse;
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) toast.error(COPY.rosterError);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, initiativeId]);

  async function mutate(method: "POST" | "DELETE", body: unknown, personId: string) {
    setPendingId(personId);
    try {
      const res = await fetch(
        `/api/initiatives/${encodeURIComponent(initiativeId)}/participants`,
        {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        toast.error(COPY.rosterError);
        return;
      }
      setData((await res.json()) as RosterResponse);
      router.refresh();
    } catch {
      toast.error(COPY.rosterError);
    } finally {
      setPendingId(null);
    }
  }

  const participantIds = new Set(data?.participants.map((p) => p.personId) ?? []);
  const addable = (data?.candidates ?? []).filter(
    (c) => !participantIds.has(c.personId),
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{COPY.rosterTitle}</SheetTitle>
          <SheetDescription>
            {COPY.rosterDescription(initiativeTitle)}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> {COPY.rosterLoading}
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">{COPY.rosterTakingPart}</p>
                {data && data.participants.length > 0 ? (
                  <ul className="flex flex-col gap-1.5">
                    {data.participants.map((p) => (
                      <li
                        key={p.personId}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span>{p.label}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-auto px-2 py-0.5 text-xs text-muted-foreground"
                          onClick={() =>
                            mutate("DELETE", { personId: p.personId }, p.personId)
                          }
                          disabled={pendingId === p.personId}
                        >
                          {pendingId === p.personId ? <Spinner /> : COPY.rosterRemove}
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {COPY.rosterNobody}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2 border-t pt-4">
                <p className="text-sm font-medium">{COPY.rosterAddLabel}</p>
                {addable.length > 0 ? (
                  <ul className="flex flex-col gap-1.5">
                    {addable.map((c) => (
                      <li
                        key={c.personId}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span>{c.label}</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-auto px-2 py-0.5 text-xs"
                          onClick={() =>
                            mutate("POST", { personIds: [c.personId] }, c.personId)
                          }
                          disabled={pendingId === c.personId}
                        >
                          {pendingId === c.personId ? <Spinner /> : COPY.rosterAdd}
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {COPY.rosterEveryoneAdded}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </ResponsiveSheetContent>
    </Sheet>
  );
}
