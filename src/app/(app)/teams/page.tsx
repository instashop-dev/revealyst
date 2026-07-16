import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

// /teams was already retired from nav (W5-H); U3 redirects it into the
// /settings/people tab (which carries the create/manage-team dialogs) and
// deletes the standalone page.
export default function TeamsRedirect() {
  permanentRedirect("/settings/people");
}
