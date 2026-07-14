import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Forwards the request pathname + query as headers so server components
// (which have no direct URL API) can read them via next/headers — used by
// src/app/(app)/layout.tsx to exempt /account from the free-band paywall
// (deleting your account must stay reachable even when blocked; see ADR 0015)
// and to carry the full destination (incl. query) through the signed-out
// bounce to /sign-in, so e.g. an expired email-verification link's
// ?error=TOKEN_EXPIRED survives to a page that can display it.
export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-pathname", request.nextUrl.pathname);
  headers.set("x-search", request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
