import { PageHeader } from "@/components/page-header";
import { UsersTable, type UsersListParams } from "@/components/admin/users-table";
import { listUsersForAdmin } from "@/db/admin";
import { requireAdminContext } from "@/lib/admin-context";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

type RawSearchParams = Record<string, string | string[] | undefined>;

function first(sp: RawSearchParams, key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

function parseParams(sp: RawSearchParams): UsersListParams {
  const sortRaw = first(sp, "sort");
  const sort = sortRaw === "name" || sortRaw === "email" ? sortRaw : "createdAt";
  const dir = first(sp, "dir") === "asc" ? "asc" : "desc";
  const orgKindRaw = first(sp, "orgKind");
  const orgKind =
    orgKindRaw === "personal" || orgKindRaw === "team" ? orgKindRaw : undefined;
  const pageRaw = Number(first(sp, "page") ?? "1");
  const page = Number.isFinite(pageRaw) && pageRaw > 1 ? Math.floor(pageRaw) : 1;

  return {
    q: first(sp, "q") ?? "",
    sort,
    dir,
    banned: first(sp, "banned") === "true" ? true : undefined,
    platformAdmin: first(sp, "admin") === "true" ? true : undefined,
    plan: first(sp, "plan") || undefined,
    orgKind,
    page,
  };
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const ctx = await requireAdminContext();
  const params = parseParams(await searchParams);
  const offset = (params.page - 1) * PAGE_SIZE;

  const { rows, total } = await listUsersForAdmin(ctx.db, {
    search: params.q || undefined,
    sort: params.sort,
    sortDir: params.dir,
    filter: {
      banned: params.banned,
      platformAdmin: params.platformAdmin,
      plan: params.plan,
      orgKind: params.orgKind,
    },
    limit: PAGE_SIZE,
    offset,
  });

  return (
    <>
      <PageHeader
        title="Users"
        description="Every signed-up user, across all orgs — search, filter, and open a profile."
      />
      <UsersTable rows={rows} total={total} pageSize={PAGE_SIZE} params={params} />
    </>
  );
}
