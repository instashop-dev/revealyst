import { beforeEach, describe, expect, it, vi } from "vitest";

// P3-A (ADR 0045) — the drill-in/roster PAGE maps loader outcomes to HTTP:
// ok → renders; `unavailable` (private) and `forbidden` (non-manager, incl.
// admin-without-grant, cross-org, unknown person) → notFound() (404); signed-out
// → requireAppContext redirects. The authorization LOGIC lives in the loader
// (tests/manager-capability-view.test.ts); this pins the mapping only, so the
// loader is mocked to return each outcome.

const h = vi.hoisted(() => ({
  ctx: null as unknown,
  drillIn: null as unknown,
  roster: null as unknown,
}));

const NOT_FOUND = new Error("NEXT_NOT_FOUND");
const REDIRECT = new Error("NEXT_REDIRECT");

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw NOT_FOUND;
  },
  redirect: () => {
    throw REDIRECT;
  },
}));
vi.mock("@/lib/api-context", () => ({
  requireAppContext: async () => {
    if (!h.ctx) throw REDIRECT; // signed-out: the real requireAppContext redirects
    return h.ctx;
  },
}));
vi.mock("@/lib/manager-capability-view", () => ({
  managerSurfaceAvailable: (m: string) => m === "managed" || m === "full",
  loadManagerCapabilityDrillIn: async () => h.drillIn,
  loadManagedRoster: async () => h.roster,
}));

import ManagerCapabilityDrillInPage from "@/app/(app)/team/[personId]/page";
import ManagerRosterPage from "@/app/(app)/team/page";

const CTX = {
  user: { id: "u-manager" },
  org: { visibilityMode: "managed" as const },
  scope: {},
};

beforeEach(() => {
  h.ctx = CTX;
  h.drillIn = null;
  h.roster = null;
});

const drillParams = { params: Promise.resolve({ personId: "p1" }) };

describe("drill-in page — outcome → HTTP mapping", () => {
  it("ok → renders (does not throw)", async () => {
    h.drillIn = {
      status: "ok",
      subject: {
        personId: "p1",
        displayName: "Ada Lovelace",
        pseudonym: "swift-otter",
        capabilities: [],
      },
    };
    await expect(ManagerCapabilityDrillInPage(drillParams)).resolves.toBeTruthy();
  });

  it("forbidden (non-manager / admin-without-grant / cross-org) → notFound (404)", async () => {
    h.drillIn = { status: "forbidden" };
    await expect(ManagerCapabilityDrillInPage(drillParams)).rejects.toBe(NOT_FOUND);
  });

  it("unavailable (private mode) → notFound (404)", async () => {
    h.drillIn = { status: "unavailable" };
    await expect(ManagerCapabilityDrillInPage(drillParams)).rejects.toBe(NOT_FOUND);
  });

  it("signed-out → redirect", async () => {
    h.ctx = null;
    await expect(ManagerCapabilityDrillInPage(drillParams)).rejects.toBe(REDIRECT);
  });
});

describe("roster page — outcome → HTTP mapping", () => {
  it("ok → renders", async () => {
    h.roster = { status: "ok", teams: [] };
    await expect(ManagerRosterPage()).resolves.toBeTruthy();
  });

  it("forbidden → notFound (404)", async () => {
    h.roster = { status: "forbidden" };
    await expect(ManagerRosterPage()).rejects.toBe(NOT_FOUND);
  });

  it("unavailable → notFound (404)", async () => {
    h.roster = { status: "unavailable" };
    await expect(ManagerRosterPage()).rejects.toBe(NOT_FOUND);
  });

  it("signed-out → redirect", async () => {
    h.ctx = null;
    await expect(ManagerRosterPage()).rejects.toBe(REDIRECT);
  });
});
