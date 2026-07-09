import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Filter,
  UsersRound,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AdminUserRow } from "@/db/admin";
import { formatRelativeTime } from "@/lib/format";

export type UsersSort = "createdAt" | "name" | "email";

/** Every filter/sort/search/page state lives in the URL — this is the
 * whole of it, parsed once by the page and threaded through here. */
export type UsersListParams = {
  q: string;
  sort: UsersSort;
  dir: "asc" | "desc";
  banned?: boolean;
  platformAdmin?: boolean;
  plan?: string;
  orgKind?: "personal" | "team";
  page: number;
};

const DEFAULT_SORT: UsersSort = "createdAt";
const DEFAULT_DIR = "desc";

/** Builds a bookmarkable `/admin/users` href from the current params plus
 * overrides — every control (sort header, filter link, pagination) is a
 * plain <Link>, never client state. */
export function buildUsersHref(
  params: UsersListParams,
  overrides: Partial<UsersListParams>,
): string {
  const merged: UsersListParams = { ...params, ...overrides };
  const usp = new URLSearchParams();
  if (merged.q) usp.set("q", merged.q);
  if (merged.sort !== DEFAULT_SORT) usp.set("sort", merged.sort);
  if (merged.dir !== DEFAULT_DIR) usp.set("dir", merged.dir);
  if (merged.banned) usp.set("banned", "true");
  if (merged.platformAdmin) usp.set("admin", "true");
  if (merged.plan) usp.set("plan", merged.plan);
  if (merged.orgKind) usp.set("orgKind", merged.orgKind);
  if (merged.page > 1) usp.set("page", String(merged.page));
  const qs = usp.toString();
  return qs ? `/admin/users?${qs}` : "/admin/users";
}

function SortLink({
  label,
  col,
  params,
}: {
  label: string;
  col: UsersSort;
  params: UsersListParams;
}) {
  const active = params.sort === col;
  const nextDir = active && params.dir === "asc" ? "desc" : "asc";
  return (
    <Link
      href={buildUsersHref(params, { sort: col, dir: nextDir, page: 1 })}
      className="inline-flex items-center gap-1 hover:text-foreground"
    >
      {label}
      {active ? (
        params.dir === "asc" ? (
          <ArrowUp className="size-3" />
        ) : (
          <ArrowDown className="size-3" />
        )
      ) : (
        <ArrowUpDown className="size-3 text-muted-foreground/50" />
      )}
    </Link>
  );
}

function activeFilterCount(params: UsersListParams): number {
  return [params.banned, params.platformAdmin, params.plan, params.orgKind].filter(
    Boolean,
  ).length;
}

function FilterMenu({ params }: { params: UsersListParams }) {
  const count = activeFilterCount(params);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <Filter data-icon="inline-start" />
        Filters
        {count > 0 ? (
          <Badge variant="secondary" className="ml-1">
            {count}
          </Badge>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuLabel>Status</DropdownMenuLabel>
        <DropdownMenuItem
          render={
            <Link
              href={buildUsersHref(params, {
                banned: params.banned ? undefined : true,
                page: 1,
              })}
            />
          }
        >
          {params.banned ? <Check data-icon="inline-start" /> : null}
          Banned
        </DropdownMenuItem>
        <DropdownMenuItem
          render={
            <Link
              href={buildUsersHref(params, {
                platformAdmin: params.platformAdmin ? undefined : true,
                page: 1,
              })}
            />
          }
        >
          {params.platformAdmin ? <Check data-icon="inline-start" /> : null}
          Platform admin
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Org kind</DropdownMenuLabel>
        <DropdownMenuItem
          render={
            <Link
              href={buildUsersHref(params, {
                orgKind: params.orgKind === "personal" ? undefined : "personal",
                page: 1,
              })}
            />
          }
        >
          {params.orgKind === "personal" ? <Check data-icon="inline-start" /> : null}
          Personal
        </DropdownMenuItem>
        <DropdownMenuItem
          render={
            <Link
              href={buildUsersHref(params, {
                orgKind: params.orgKind === "team" ? undefined : "team",
                page: 1,
              })}
            />
          }
        >
          {params.orgKind === "team" ? <Check data-icon="inline-start" /> : null}
          Team
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Plan</DropdownMenuLabel>
        <DropdownMenuItem
          render={
            <Link
              href={buildUsersHref(params, {
                plan: params.plan === "personal" ? undefined : "personal",
                page: 1,
              })}
            />
          }
        >
          {params.plan === "personal" ? <Check data-icon="inline-start" /> : null}
          Personal
        </DropdownMenuItem>
        <DropdownMenuItem
          render={
            <Link
              href={buildUsersHref(params, {
                plan: params.plan === "team" ? undefined : "team",
                page: 1,
              })}
            />
          }
        >
          {params.plan === "team" ? <Check data-icon="inline-start" /> : null}
          Team
        </DropdownMenuItem>
        {count > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              render={
                <Link
                  href={buildUsersHref(params, {
                    banned: undefined,
                    platformAdmin: undefined,
                    plan: undefined,
                    orgKind: undefined,
                    page: 1,
                  })}
                />
              }
            >
              Clear filters
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SearchForm({ params }: { params: UsersListParams }) {
  return (
    <form action="/admin/users" method="get" className="flex items-center gap-2">
      {params.sort !== DEFAULT_SORT ? (
        <input type="hidden" name="sort" value={params.sort} />
      ) : null}
      {params.dir !== DEFAULT_DIR ? (
        <input type="hidden" name="dir" value={params.dir} />
      ) : null}
      {params.banned ? <input type="hidden" name="banned" value="true" /> : null}
      {params.platformAdmin ? (
        <input type="hidden" name="admin" value="true" />
      ) : null}
      {params.plan ? <input type="hidden" name="plan" value={params.plan} /> : null}
      {params.orgKind ? (
        <input type="hidden" name="orgKind" value={params.orgKind} />
      ) : null}
      <Input
        type="search"
        name="q"
        placeholder="Search name or email"
        defaultValue={params.q}
        className="w-64"
        aria-label="Search users"
      />
      <Button type="submit" variant="outline" size="sm">
        Search
      </Button>
      {params.q ? (
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href={buildUsersHref(params, { q: "", page: 1 })} />}
        >
          Clear
        </Button>
      ) : null}
    </form>
  );
}

function Pagination({
  params,
  total,
  pageSize,
}: {
  params: UsersListParams;
  total: number;
  pageSize: number;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasPrev = params.page > 1;
  const hasNext = params.page < totalPages;
  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-sm text-muted-foreground">
        Page {params.page} of {totalPages} · {total} user{total === 1 ? "" : "s"}
      </p>
      <div className="flex items-center gap-2">
        {hasPrev ? (
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={buildUsersHref(params, { page: params.page - 1 })} />}
          >
            Previous
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Previous
          </Button>
        )}
        {hasNext ? (
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={buildUsersHref(params, { page: params.page + 1 })} />}
          >
            Next
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * The `/admin/users` list surface: search form, filter dropdown, sortable
 * column headers, the table itself (or an empty state), and pagination.
 * Every piece of state is a URL param (rule: bookmarkable, zero client
 * state) — this component renders links, it doesn't hold state.
 */
export function UsersTable({
  rows,
  total,
  pageSize,
  params,
}: {
  rows: AdminUserRow[];
  total: number;
  pageSize: number;
  params: UsersListParams;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SearchForm params={params} />
        <FilterMenu params={params} />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title={total === 0 ? "No users yet" : "No matching users"}
          description={
            total === 0
              ? "Users appear here once someone signs up."
              : "Try clearing search or filters."
          }
        />
      ) : (
        <>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <div className="flex items-center gap-2">
                      <SortLink label="Name" col="name" params={params} />
                      <span className="text-muted-foreground/50">·</span>
                      <SortLink label="Email" col="email" params={params} />
                    </div>
                  </TableHead>
                  <TableHead>Org</TableHead>
                  <TableHead>Org role</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">
                    <SortLink label="Signed up" col="createdAt" params={params} />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link
                        href={`/admin/users/${row.id}`}
                        className="font-medium hover:underline"
                      >
                        {row.name || "—"}
                      </Link>
                      <div className="text-xs text-muted-foreground">{row.email}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span>{row.orgName}</span>
                        <Badge variant="outline" className="capitalize">
                          {row.orgKind}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {row.orgRole}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize">
                        {row.plan}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {row.banned ? (
                          <Badge variant="destructive">Banned</Badge>
                        ) : null}
                        {row.platformAdmin ? (
                          <Badge variant="outline">Platform admin</Badge>
                        ) : null}
                        {!row.banned && !row.platformAdmin ? (
                          <span className="text-muted-foreground">—</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatRelativeTime(row.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination params={params} total={total} pageSize={pageSize} />
        </>
      )}
    </div>
  );
}
