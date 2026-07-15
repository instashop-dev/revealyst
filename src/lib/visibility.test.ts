import { describe, expect, it } from "vitest";
import {
  assertTeamOnlyPseudonymized,
  identityManifestGaps,
  IDENTITY_BEARING_MANIFEST,
  TEAM_VISIBLE_IDENTITY_SURFACES,
  toPersonRef,
  type TeamVisibleView,
} from "./visibility";

// §7 privacy enforced by shape: the single pseudonymisation gate. `private`
// (the default) hides real names; the strict personRefSchema means nothing
// beyond {id, pseudonym, displayName} can ever leak.
describe("toPersonRef", () => {
  const person = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    pseudonym: "brisk-otter",
    displayName: "Alice Real",
  };

  it("hides the real name in private mode (the default)", () => {
    expect(toPersonRef(person, "private")).toEqual({
      id: person.id,
      pseudonym: "brisk-otter",
      displayName: null,
    });
  });

  it("passes the real name through in managed and full modes", () => {
    expect(toPersonRef(person, "managed").displayName).toBe("Alice Real");
    expect(toPersonRef(person, "full").displayName).toBe("Alice Real");
  });

  it("treats a missing display name as null", () => {
    const ref = toPersonRef(
      { id: person.id, pseudonym: "quiet-heron" },
      "full",
    );
    expect(ref.displayName).toBeNull();
  });

  it("never carries any field beyond the strict person ref", () => {
    const leaky = {
      ...person,
      email: "alice@example.com",
      authUserId: "auth-123",
    } as unknown as Parameters<typeof toPersonRef>[0];
    const ref = toPersonRef(leaky, "full");
    expect(Object.keys(ref).sort()).toEqual(["displayName", "id", "pseudonym"]);
  });
});

// W5-A: the §7 audit predicate is now a registry of identity-bearing surfaces
// with a completeness tripwire, so a 4th team-visible identity surface added
// later can no longer pass the audit vacuously (the old hand-written check's
// gap, Spec §9.4a). These pin the registry to the manifest and prove each
// registered surface actually throws when it leaks.
describe("assertTeamOnlyPseudonymized surface registry", () => {
  const PID = "550e8400-e29b-41d4-a716-446655440000";
  // A PersonRef carrying (or hiding) a real name — "full" passes displayName
  // through, so this mints a leaking or a clean ref as needed.
  const ref = (displayName: string | null) =>
    toPersonRef({ id: PID, pseudonym: "brisk-otter", displayName }, "full");

  /** A fully-pseudonymized (private-default) view: nothing leaks. */
  const cleanView = (): TeamVisibleView => ({
    summary: { scores: [{ person: ref(null) }] },
    segments: { segments: [{ members: [] }] },
    sharedAccounts: [{ externalId: null }],
  });

  it("the manifest is covered by the registry exactly (completeness tripwire)", () => {
    expect(
      identityManifestGaps(
        IDENTITY_BEARING_MANIFEST,
        TEAM_VISIBLE_IDENTITY_SURFACES,
      ),
    ).toEqual({ missing: [], extra: [] });
  });

  it("a synthetic UNREGISTERED identity surface fails the tripwire", () => {
    // Simulate a 4th identity-bearing field added to the view + manifest but
    // NOT registered as a surface — the acceptance criterion. `missing`
    // (non-empty) is exactly what the completeness test asserts against.
    const withNewSurface = [
      ...IDENTITY_BEARING_MANIFEST,
      "summary.leaderboard[].person.displayName",
    ];
    const gaps = identityManifestGaps(
      withNewSurface,
      TEAM_VISIBLE_IDENTITY_SURFACES,
    );
    expect(gaps.missing).toEqual([
      "summary.leaderboard[].person.displayName",
    ]);
    expect(gaps.extra).toEqual([]);
  });

  it("a stale REGISTERED surface absent from the manifest also fails", () => {
    const shrunkManifest = IDENTITY_BEARING_MANIFEST.filter(
      (f) => f !== "sharedAccounts[].externalId",
    );
    const gaps = identityManifestGaps(
      shrunkManifest,
      TEAM_VISIBLE_IDENTITY_SURFACES,
    );
    expect(gaps.extra).toEqual(["sharedAccounts[].externalId"]);
    expect(gaps.missing).toEqual([]);
  });

  it("passes for a fully-pseudonymized view", () => {
    expect(() => assertTeamOnlyPseudonymized(cleanView())).not.toThrow();
  });

  it("throws when the score surface leaks a real name", () => {
    const view = cleanView();
    view.summary = { scores: [{ person: ref("Grace Hopper") }] };
    expect(() => assertTeamOnlyPseudonymized(view)).toThrow(
      /score exposes a real name/,
    );
  });

  it("throws when the segments surface lists an individual member", () => {
    const view = cleanView();
    view.segments = { segments: [{ members: [ref("Ada")] }] };
    expect(() => assertTeamOnlyPseudonymized(view)).toThrow(
      /segment surfaces 1 individual member/,
    );
  });

  it("throws when the shared-account surface exposes an identifier", () => {
    const view = cleanView();
    view.sharedAccounts = [{ externalId: "shared-team-login" }];
    expect(() => assertTeamOnlyPseudonymized(view)).toThrow(
      /shared-account flag exposes a real account identifier/,
    );
  });

  // T2.1: attention items carry no identity-bearing field today (every
  // real team-level item is built from org-aggregate inputs), but the
  // surface is registered — with a live `person` check — so a FUTURE
  // per-person item folded into the team strip can't leak silently.
  it("passes when attention items are absent (today's real shape)", () => {
    expect(() => assertTeamOnlyPseudonymized(cleanView())).not.toThrow();
  });

  it("passes when attention items carry no person", () => {
    const view = cleanView();
    view.attentionItems = [{}, { person: null }];
    expect(() => assertTeamOnlyPseudonymized(view)).not.toThrow();
  });

  it("throws when a (hypothetical future) attention item exposes a real name", () => {
    const view = cleanView();
    view.attentionItems = [{ person: ref("Grace Hopper") }];
    expect(() => assertTeamOnlyPseudonymized(view)).toThrow(
      /attention item exposes a real name/,
    );
  });
});
