import { NextResponse } from "next/server";
import type { z } from "zod";
import { appContext, type AppContext } from "@/lib/api-context";
import { ApiError } from "@/lib/api-impl";
import { computeAccess } from "@/lib/access";

/**
 * Shared HTTP glue for contract route handlers: session (401), role
 * gate (403), free-band paywall (402), ApiError mapping. Anything else escapes
 * as a 500 — a frozen-contract response failing to parse should be loud, not a
 * 400.
 *
 * The free-band gate is ON by default and fail-closed: a blocked org gets 402
 * on every data route, so the paywall covers the JSON APIs, not just the
 * rendered pages. Routes that must work WHILE blocked (the upgrade/manage
 * paths) opt out with `allowOverFreeBand`.
 */
export async function handleApi(
  fn: (ctx: AppContext) => Promise<unknown>,
  opts: { adminOnly?: boolean; allowOverFreeBand?: boolean } = {},
): Promise<NextResponse> {
  const ctx = await appContext();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (opts.adminOnly && ctx.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!opts.allowOverFreeBand) {
    const access = await computeAccess(ctx.db, ctx.scope, ctx.org);
    if (access.blocked) {
      return NextResponse.json(
        { error: "upgrade required" },
        { status: 402 },
      );
    }
  }
  return respondWith(fn, ctx);
}

/**
 * Run a handler and serialize its result / ApiError the standard way. The
 * single response-shape seam shared by handleApi and handleAdminApi
 * (src/lib/admin-context.ts) so the error envelope can't drift between the
 * customer and admin API surfaces.
 */
export async function respondWith(
  fn: (ctx: AppContext) => Promise<unknown>,
  ctx: AppContext,
): Promise<NextResponse> {
  try {
    return NextResponse.json(await fn(ctx));
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    throw error;
  }
}

/**
 * Query-string parse per a frozen request schema; malformed input is a 400.
 * Call inside the `handleApi` callback so the ApiError maps to a status
 * rather than escaping as a 500.
 */
export function parseQuery<Schema extends z.ZodType>(
  schema: Schema,
  req: Request,
): z.infer<Schema> {
  const { searchParams } = new URL(req.url);
  const result = schema.safeParse(Object.fromEntries(searchParams));
  if (!result.success) {
    throw new ApiError(400, "invalid query parameters");
  }
  return result.data;
}

/** Body parse per the frozen request schema; malformed input is a 400. */
export async function parseBody<Schema extends z.ZodType>(
  schema: Schema,
  req: Request,
): Promise<z.infer<Schema>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new ApiError(400, "invalid JSON body");
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new ApiError(400, "invalid request body");
  }
  return result.data;
}
