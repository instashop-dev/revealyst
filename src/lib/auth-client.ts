import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  // authClient.admin.* — set-role / ban / impersonate etc. Server-side the
  // endpoints are gated + audited in src/lib/auth.ts hooks (ADR 0016).
  plugins: [adminClient()],
});
