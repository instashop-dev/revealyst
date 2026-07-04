import { getAuth } from "@/lib/auth";

// Better Auth catch-all. Instantiated per request (getAuth) because the
// Cloudflare env only exists inside a request context on Workers.
const handler = (req: Request) => getAuth().handler(req);

export { handler as GET, handler as POST };
