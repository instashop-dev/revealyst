import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// /settings has no content of its own — it lands on the Profile tab, the one
// tab everyone (member or admin) can see.
export default function SettingsIndexPage() {
  redirect("/settings/profile");
}
