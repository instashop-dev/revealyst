import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Forwards the request pathname as a header so server components (which have
// no direct pathname API) can read it via next/headers — used by
// src/app/(app)/layout.tsx to exempt /account from the free-band paywall
// (deleting your account must stay reachable even when blocked; see ADR 0014).
export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-pathname", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
