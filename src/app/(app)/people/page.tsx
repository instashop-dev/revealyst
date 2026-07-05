import { UserRound } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireAppContext } from "@/lib/api-context";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const ctx = await requireAppContext();
  const people = await ctx.scope.people.list();
  // §7 privacy: pseudonymous by default — real names render only when the
  // org has opted out of Private mode. Same rule as the frozen personRef
  // contract shape.
  const showNames = ctx.org.visibilityMode !== "private";

  return (
    <>
      <PageHeader
        title="People"
        description="Tracked people in this workspace — pseudonymized by default."
      >
        {!showNames ? <Badge variant="outline">Private mode</Badge> : null}
      </PageHeader>
      {people.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title="No people yet"
          description="People appear here when connectors discover vendor accounts and identities are resolved to real humans — never fabricated from shared accounts."
        />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pseudonym</TableHead>
                <TableHead>Name</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {people.map((person) => (
                <TableRow key={person.id}>
                  <TableCell className="font-medium">
                    {person.pseudonym}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {!showNames
                      ? "Hidden in Private mode"
                      : (person.displayName ?? "—")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
