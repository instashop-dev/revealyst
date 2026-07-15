import { requireAppContext } from "@/lib/api-context";
import { PersonalSelfView } from "./personal-self-view";
import { TeamOverview } from "./team-overview";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const ctx = await requireAppContext();

  // Neither branch stacks a separate `connections.list()` round trip ahead of
  // its data read. The team path: `readDashboardView` already fetches
  // connections inside its depth-1 Promise.all and returns them, so
  // TeamOverview renders its Connections panel + attention strip from
  // `view.connections`. The personal path: the connections read is started
  // here (in flight) and FOLDED into PersonalSelfView's depth-1 Promise.all,
  // where the onboarding gate is evaluated once it resolves — so the gate no
  // longer costs a serial Workers→Hyperdrive→Neon hop (~250–500ms of
  // authenticated TTFB) ahead of the page's other reads on the common
  // already-connected login that lands here.
  if (ctx.org.kind === "personal") {
    return (
      <PersonalSelfView
        ctx={ctx}
        connectionsPromise={ctx.scope.connections.list()}
      />
    );
  }
  return <TeamOverview ctx={ctx} />;
}
