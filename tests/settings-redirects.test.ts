import { beforeEach, describe, expect, it, vi } from "vitest";

// U3: the old standalone routes are consolidated under /settings/*. Each old
// page is now a thin 308 (permanentRedirect) so bookmarks + email links keep
// resolving; /settings itself lands on the Profile tab (redirect). These tests
// pin every target so a future rename can't silently strand a redirect.

const permanentRedirect = vi.fn();
const redirect = vi.fn();
vi.mock("next/navigation", () => ({
  permanentRedirect: (url: string) => permanentRedirect(url),
  redirect: (url: string) => redirect(url),
}));

beforeEach(() => {
  permanentRedirect.mockClear();
  redirect.mockClear();
});

describe("old-route 308 redirects → /settings/*", () => {
  it("/account → /settings/profile", async () => {
    const { default: page } = await import("../src/app/(app)/account/page");
    page();
    expect(permanentRedirect).toHaveBeenCalledWith("/settings/profile");
  });

  it("/billing → /settings/billing", async () => {
    const { default: page } = await import("../src/app/(app)/billing/page");
    page();
    expect(permanentRedirect).toHaveBeenCalledWith("/settings/billing");
  });

  it("/members → /settings/people", async () => {
    const { default: page } = await import("../src/app/(app)/members/page");
    page();
    expect(permanentRedirect).toHaveBeenCalledWith("/settings/people");
  });

  it("/teams → /settings/people", async () => {
    const { default: page } = await import("../src/app/(app)/teams/page");
    page();
    expect(permanentRedirect).toHaveBeenCalledWith("/settings/people");
  });

  it("/people → /settings/people", async () => {
    const { default: page } = await import("../src/app/(app)/people/page");
    page();
    expect(permanentRedirect).toHaveBeenCalledWith("/settings/people");
  });
});

describe("/settings index → Profile tab", () => {
  it("lands members and admins on /settings/profile (the one everyone tab)", async () => {
    const { default: page } = await import("../src/app/(app)/settings/page");
    page();
    expect(redirect).toHaveBeenCalledWith("/settings/profile");
  });
});
