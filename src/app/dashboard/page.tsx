import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createDb } from "@/db/client";
import { membershipForUser } from "@/db/org-scope";
import { getAuth } from "@/lib/auth";

// Authenticated pages can't prerender: session + Cloudflare env exist only
// at request time.
export const dynamic = "force-dynamic";

// The W0 exit-gate item: an authenticated page served in production.
export default async function DashboardPage() {
  const session = await getAuth().api.getSession({
    headers: await headers(),
  });
  if (!session) {
    redirect("/sign-in");
  }

  const db = createDb(getCloudflareContext().env);
  const membership = await membershipForUser(db, session.user.id);

  return (
    <main>
      <h1>Dashboard</h1>
      <p>
        Signed in as <strong>{session.user.email}</strong>
      </p>
      <p>
        Org: <strong>{membership?.orgName ?? "—"}</strong>
      </p>
      <p className="status">Walking skeleton · W0-B · authenticated</p>
    </main>
  );
}
