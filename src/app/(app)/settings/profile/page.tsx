import { AccountProfileForm } from "@/components/account/account-profile-form";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { DeleteAccountDialog } from "@/components/account/delete-account-dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { hasCredentialAccount } from "@/db/account-deletion";
import { requireAppContext } from "@/lib/api-context";

export const dynamic = "force-dynamic";

// Profile tab (U3) — moved from the retired /account page. Everyone (member or
// admin) manages their own profile, password, and account here.
export default async function SettingsProfilePage() {
  const ctx = await requireAppContext("/settings/profile");
  // GitHub-OAuth-only users have no password credential — change-password and
  // password-gated delete both 400 for them if rendered as normal (review
  // finding). Detect it once here and adapt both cards.
  const hasPassword = await hasCredentialAccount(ctx.db, ctx.user.id);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your display name and email address.</CardDescription>
        </CardHeader>
        <CardContent>
          <AccountProfileForm name={ctx.user.name ?? ""} email={ctx.user.email} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            Change the password you use to sign in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm hasPassword={hasPassword} />
        </CardContent>
      </Card>

      {/* Danger zone last, visually separated (plan §5.7). */}
      <Card className="ring-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>
            Permanently delete your account and personal workspace. This cannot
            be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteAccountDialog hasPassword={hasPassword} />
        </CardContent>
      </Card>
    </div>
  );
}
