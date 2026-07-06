import { describe, expect, it } from "vitest";
import { toPersonRef } from "./visibility";

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
