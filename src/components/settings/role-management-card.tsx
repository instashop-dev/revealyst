import { IdCard } from "lucide-react";
import {
  PersonRoleSelect,
  type RoleOption,
} from "@/components/settings/person-role-select";
import { EmptyState } from "@/components/empty-state";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type RolePersonRow = {
  id: string;
  /** §7-gated label upstream: real name only when visibility permits. */
  label: string;
  roleSlug: string | null;
};

/**
 * W6-B (ADR 0030): assign each tracked person an engineering role. Server
 * component — the caller (settings page) supplies the already-fetched, §7-gated
 * rows and the global role list, so this adds no data-access logic of its own.
 * Manager-set org config (not self-view); rendered for admins only. Nothing
 * else consumes roles until W6-C.
 */
export function RoleManagementCard({
  people,
  roles,
}: {
  people: RolePersonRow[];
  roles: RoleOption[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Roles</CardTitle>
        <CardDescription>
          Assign each tracked person an engineering role. Used to tailor
          role-specific coaching; set manually here — never synced from an HR
          system.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {people.length === 0 ? (
          <EmptyState
            icon={IdCard}
            title="No people yet"
            description="Connect a tool so tracked people appear here, then assign their roles."
          />
        ) : (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead className="w-56 text-right">Role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {people.map((person) => (
                  <TableRow key={person.id}>
                    <TableCell className="font-medium">
                      {person.label}
                    </TableCell>
                    <TableCell className="text-right">
                      <PersonRoleSelect
                        personId={person.id}
                        personLabel={person.label}
                        current={person.roleSlug}
                        roles={roles}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
