import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

// /members consolidated into the /settings/people tab (U3). Kept as a 308 so
// old links keep resolving.
export default function MembersRedirect() {
  permanentRedirect("/settings/people");
}
