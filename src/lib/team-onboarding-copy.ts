// Copy module (D-ONB-1): all user-facing prose for creating a team workspace and
// getting a new team started lives here — plain English for beginners, no
// jargon, no fabricated numbers. The create dialog is shared (admin seam +
// user-facing switcher), so its wording lives in one place per surface.

export type CreateTeamWorkspaceDialogCopy = {
  /** Dialog heading. */
  title: string;
  /** One-line explanation of what creating a workspace does. */
  description: string;
  /** Label for the single name field. */
  nameLabel: string;
  /** Submit button (idle). */
  submit: string;
  /** Success toast; takes the new workspace name. */
  success: (name: string) => string;
  /** Fallback error toast when the server gives no message; takes the status. */
  errorFallback: (status: number) => string;
};

/** The user-facing flow, opened from the sidebar workspace switcher. */
export const CREATE_TEAM_WORKSPACE_COPY: CreateTeamWorkspaceDialogCopy = {
  title: "Create a team workspace",
  description:
    "A team workspace is a shared space where you can invite people and see how your team uses AI together. Your personal workspace stays as it is — switch between them any time from the sidebar.",
  nameLabel: "Workspace name",
  submit: "Create workspace",
  success: (name) => `"${name}" is ready — you're now in it`,
  errorFallback: (status) => `Could not create the workspace (${status})`,
};

/** The platform-admin seam (the /admin dashboard button). Wording matches the
 * admin's context — they may be provisioning a workspace for someone else. */
export const ADMIN_CREATE_TEAM_WORKSPACE_COPY: CreateTeamWorkspaceDialogCopy = {
  title: "New team workspace",
  description:
    "Creates a separate team workspace and adds you as its admin. Your personal workspace is left as is — switch between them any time from the sidebar.",
  nameLabel: "Workspace name",
  submit: "Create workspace",
  success: (name) => `Workspace "${name}" created — you're now in it`,
  errorFallback: (status) => `Could not create workspace (${status})`,
};

/** The switcher menu item that opens the create dialog. */
export const CREATE_TEAM_WORKSPACE_MENU_ITEM = "Create team workspace";

/**
 * The plain-English message shown when a user has hit the per-user cap on team
 * workspaces they have CREATED (ADR 0052). Server-owned (returned by POST
 * /api/workspaces) so it can't drift from the enforced limit; takes the live
 * cap so the number is never hard-coded in prose. States the fact only — no
 * remediation is prescribed, because no leave/delete-workspace affordance
 * exists (a "leave one" instruction would be an impossible action).
 */
export const teamWorkspaceCapMessage = (max: number): string =>
  `You've created ${max} team workspaces, which is the maximum for one account.`;

/**
 * The invite call-to-action shown on a brand-new team workspace's empty state,
 * so the create → invite path is coherent the moment the creator lands. Points
 * at Settings → People, where the invite affordance lives.
 */
export const NEW_TEAM_INVITE_CTA = {
  action: "Invite your team",
} as const;
