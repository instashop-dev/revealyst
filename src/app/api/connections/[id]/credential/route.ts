import { apiRoutes } from "@/contracts/api";
import { putConnectionCredential } from "@/lib/api-impl";
import { handleApi, parseBody } from "@/lib/api-route";
import type { CredentialEnv } from "@/lib/credentials";

export const dynamic = "force-dynamic";

/** POST /api/connections/:id/credential — frozen connectionCredentialPut
 * contract. Write-only: the plaintext goes in, only `ok` comes back. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(async (ctx) => {
    const body = await parseBody(apiRoutes.connectionCredentialPut.request, req);
    // Audit happens inside the impl, right after the store — so a
    // validate-on-save rejection (400) still leaves the who-stored-it row.
    return putConnectionCredential(
      ctx.scope,
      id,
      body,
      ctx.env as CredentialEnv,
      ctx.user.id,
    );
  });
}
