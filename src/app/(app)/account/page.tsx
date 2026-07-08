import { PageHeader } from "@/components/page-header";
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

export default async function AccountPage() {
  const ctx = await requireAppContext("/account");
  // GitHub-OAuth-only users have no password credential — change-password and
  // password-gated delete both 400 for them if rendered as normal (review
  // finding). Detect it once here and adapt both cards.
  const hasPassword = await hasCredentialAccount(ctx.db, ctx.user.id);

  return (
    <>
      <PageHeader
        title="Account"
        description="Manage your profile, password, and account."
      />
      <div className="flex max-w-2xl flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Your display name and email address.</CardDescription>
          </CardHeader>
          <CardContent>
            <AccountProfileForm
              name={ctx.user.name ?? ""}
              email={ctx.user.email}
            />
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

        <Card>
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
    </>
  );
}
