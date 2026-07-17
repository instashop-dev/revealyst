import { requireAppContext } from "@/lib/api-context";
import { PersonalSelfView } from "./personal-self-view";
import { TeamOverview } from "./team-overview";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const ctx = await requireAppContext();

  // ctx is used ONLY to pick the branch — never passed as a prop. Each view
  // re-calls requireAppContext() itself: React's `cache()` dedupes it within
  // the request (zero extra queries), and a server-component prop carrying
  // the AppContext breaks `next dev` — the dev flight stream serializes
  // element props as debug info, and introspecting ctx.env (the miniflare
  // magic proxy) RPCs into workerd ("Failed to get handler to worker"),
  // felling the whole route to its error boundary. Neither branch stacks a
  // separate `connections.list()` round trip ahead of its data read: the
  // team path reads connections inside readDashboardView's depth-1
  // Promise.all; the personal path kicks the read off (in flight) as its
  // first statement and folds it into its own depth-1 batch.
  if (ctx.org.kind === "personal") {
    return <PersonalSelfView />;
  }
  return <TeamOverview />;
}
