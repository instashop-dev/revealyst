import { handleApi, parseBody } from "@/lib/api-route";
import {
  applyReconcileAction,
  reconcileActionSchema,
} from "@/lib/reconcile-actions";

// Manual reconciliation actions (W2-K). Admin-only. The action logic lives in
// src/lib/reconcile-actions.ts (unit-tested against the repo layer); this
// route is thin HTTP glue.
export async function POST(req: Request) {
  return handleApi(
    async (ctx) => {
      const action = await parseBody(reconcileActionSchema, req);
      return applyReconcileAction(ctx.scope, ctx.user.id, action);
    },
    { adminOnly: true },
  );
}
