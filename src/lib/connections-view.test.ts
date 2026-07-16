import { describe, expect, it } from "vitest";
import {
  countConnectedSources,
  coverageSummaryLine,
  deriveConnectionIssues,
  latestGapKindsByConnection,
} from "./connections-view";

describe("coverage summary — counts only", () => {
  it("counts every non-pending connection as a connected source", () => {
    const conns = [
      { status: "active" },
      { status: "error" },
      { status: "paused" },
      { status: "pending" },
    ];
    expect(countConnectedSources(conns)).toBe(3);
  });

  it("singular vs plural, and never a percentage", () => {
    expect(coverageSummaryLine([{ status: "active" }])).toBe("1 source connected");
    expect(coverageSummaryLine([{ status: "active" }, { status: "active" }])).toBe(
      "2 sources connected",
    );
    expect(coverageSummaryLine([])).toBe("0 sources connected");
    expect(coverageSummaryLine([{ status: "pending" }])).toBe("0 sources connected");
  });
});

describe("latestGapKindsByConnection", () => {
  it("keeps the gaps of the latest run per connection", () => {
    const map = latestGapKindsByConnection([
      {
        connectionId: "c1",
        startedAt: "2026-07-10T00:00:00Z",
        gaps: [{ kind: "oauth_actors_missing" }],
      },
      {
        connectionId: "c1",
        startedAt: "2026-07-16T00:00:00Z",
        gaps: [{ kind: "sub_daily_unavailable" }],
      },
    ]);
    // The newer run wins.
    expect(map.get("c1")).toEqual(["sub_daily_unavailable"]);
  });

  it("drops unknown/malformed gap kinds and de-dupes", () => {
    const map = latestGapKindsByConnection([
      {
        connectionId: "c2",
        startedAt: "2026-07-16T00:00:00Z",
        gaps: [
          { kind: "sub_daily_unavailable" },
          { kind: "sub_daily_unavailable" },
          { kind: "not_a_real_kind" },
          "garbage",
          null,
        ],
      },
    ]);
    expect(map.get("c2")).toEqual(["sub_daily_unavailable"]);
  });

  it("has no entry for a connection whose latest run has no known gaps", () => {
    const map = latestGapKindsByConnection([
      { connectionId: "c3", startedAt: "2026-07-16T00:00:00Z", gaps: [] },
    ]);
    expect(map.has("c3")).toBe(false);
  });
});

describe("deriveConnectionIssues", () => {
  const now = new Date("2026-07-16T12:00:00Z");

  it("surfaces failed syncs with the honest vendor error", () => {
    const issues = deriveConnectionIssues({
      now,
      connections: [
        {
          id: "c1",
          displayName: "OpenAI",
          status: "error",
          lastError: "401 unauthorized",
          renewalDate: null,
        },
      ],
    });
    expect(issues).toEqual([
      {
        kind: "sync_error",
        connectionId: "c1",
        displayName: "OpenAI",
        message: "401 unauthorized",
      },
    ]);
  });

  it("surfaces renewals within 30 days (and past-due), but not further out", () => {
    const issues = deriveConnectionIssues({
      now,
      connections: [
        {
          id: "soon",
          displayName: "Cursor",
          status: "active",
          lastError: null,
          renewalDate: "2026-07-30", // 14 days
        },
        {
          id: "past",
          displayName: "Anthropic",
          status: "active",
          lastError: null,
          renewalDate: "2026-07-01", // past
        },
        {
          id: "far",
          displayName: "Copilot",
          status: "active",
          lastError: null,
          renewalDate: "2026-09-30", // >30 days
        },
      ],
    });
    expect(issues.map((i) => i.connectionId)).toEqual(["soon", "past"]);
    expect(issues.find((i) => i.connectionId === "soon")?.message).toContain(
      "14 days",
    );
    expect(issues.find((i) => i.connectionId === "past")?.message).toContain(
      "passed",
    );
  });

  it("emits both a sync error and a renewal warning for the same connection", () => {
    const issues = deriveConnectionIssues({
      now,
      connections: [
        {
          id: "c1",
          displayName: "OpenAI",
          status: "error",
          lastError: "boom",
          renewalDate: "2026-07-20",
        },
      ],
    });
    expect(issues.map((i) => i.kind)).toEqual(["sync_error", "renewal_due"]);
  });

  it("is empty when everything is healthy", () => {
    expect(
      deriveConnectionIssues({
        now,
        connections: [
          {
            id: "c1",
            displayName: "OpenAI",
            status: "active",
            lastError: null,
            renewalDate: null,
          },
        ],
      }),
    ).toEqual([]);
  });
});
