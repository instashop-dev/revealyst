import { NextResponse } from "next/server";
import type { z } from "zod";
import { appContext, type AppContext } from "@/lib/api-context";
import { ApiError } from "@/lib/api-impl";

/**
 * Shared HTTP glue for contract route handlers: session (401), role
 * gate (403), ApiError mapping. Anything else escapes as a 500 — a
 * frozen-contract response failing to parse should be loud, not a 400.
 */
export async function handleApi(
  fn: (ctx: AppContext) => Promise<unknown>,
  opts: { adminOnly?: boolean } = {},
): Promise<NextResponse> {
  const ctx = await appContext();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (opts.adminOnly && ctx.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
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
