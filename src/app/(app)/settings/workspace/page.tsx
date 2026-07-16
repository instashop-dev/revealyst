import { ClipboardButton } from "@/components/clipboard-button";
import { AdminOnlyNotice } from "@/components/settings/admin-only-notice";
import { WorkspaceNameForm } from "@/components/settings/workspace-name-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireAppContext } from "@/lib/api-context";

export const dynamic = "force-dynamic";

// Workspace tab (U3) — admin-only. The per-page role check stays authoritative
// (the PATCH route enforces the same), rendering an in-place explanation rather
// than redirecting a member who deep-links here.
export default async function SettingsWorkspacePage() {
  const ctx = await requireAppContext("/settings/workspace");
  if (ctx.role !== "admin") {
    return <AdminOnlyNotice />;
  }

  const isPersonal = ctx.org.kind === "personal";

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Workspace name</CardTitle>
          <CardDescription>
            {isPersonal
              ? "The name of your personal workspace."
              : "The name your team sees across Revealyst."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WorkspaceNameForm name={ctx.org.name} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Workspace ID</CardTitle>
          <CardDescription>
            A unique identifier for this workspace. Useful when contacting
            support.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 font-mono text-sm">
              {ctx.org.id}
            </code>
            <ClipboardButton
              value={ctx.org.id}
              label="Copy workspace ID"
              successMessage="Workspace ID copied"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
