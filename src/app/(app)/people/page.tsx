import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

// /people was already retired from nav (W5-H); U3 redirects it into the
// /settings/people tab (whose role management folds in the pseudonymized
// person list) and deletes the standalone page.
export default function PeopleRedirect() {
  permanentRedirect("/settings/people");
}
