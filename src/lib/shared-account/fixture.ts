import type { SharedAccountFlag, SharedAccountSource } from "./index";

// Fixture shared-account detector: a subject linked to ≥2 resolved people is a
// shared account (§6.2 — one subject, N identity rows). Derived from existing
// org-scoped reads only, so it fires on real seeded data (the team fixture's
// `shared-console` has 3 identities) with zero new tables. W2-K's real detector
// (round-the-clock activity, volume ≫ median, concurrency) swaps in here.
export const fixtureSharedAccountSource: SharedAccountSource = {
  async flags(scope) {
    const [subjects, connections] = await Promise.all([
      scope.subjects.list(),
      scope.connections.list(),
    ]);
    const vendorByConnection = new Map(
      connections.map((c) => [c.id, c.vendor]),
    );

    const flags: SharedAccountFlag[] = [];
    for (const subject of subjects) {
      const links = await scope.identities.forSubject(subject.id);
      if (links.length < 2) continue; // not shared — single person or unresolved
      flags.push({
        subjectId: subject.id,
        connectionId: subject.connectionId,
        vendor: vendorByConnection.get(subject.connectionId) ?? "unknown",
        externalId: subject.externalId,
        identityCount: links.length,
      });
    }
    return flags;
  },
};
