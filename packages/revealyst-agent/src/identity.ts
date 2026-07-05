// Local identity resolution (docs/connector-facts.md §5): the machine's
// user via the consented oauthAccount in <home>/.claude.json. When absent
// (or consent withheld), fall back to a stable device-scoped ACCOUNT
// subject — never fabricate a person (review invariant b). Attribution
// follows the subject kind: person ⇢ "person", device ⇢ "account".

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AttributionLevel, SubjectDescriptor } from "./types";

export type LocalIdentity = {
  descriptor: SubjectDescriptor;
  attribution: AttributionLevel;
};

/** Reads oauthAccount.emailAddress from <home>/.claude.json. Never throws;
 * any read/parse failure means "no identity available". */
export function readOauthEmail(
  homeDir: string,
): { email: string; displayName: string | null } | null {
  try {
    const raw = readFileSync(join(homeDir, ".claude.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      oauthAccount?: { emailAddress?: unknown; displayName?: unknown };
    };
    const email = parsed.oauthAccount?.emailAddress;
    if (typeof email !== "string" || !email.includes("@")) {
      return null;
    }
    const displayName = parsed.oauthAccount?.displayName;
    return {
      email: email.toLowerCase(),
      displayName: typeof displayName === "string" ? displayName : null,
    };
  } catch {
    return null;
  }
}

/**
 * @param consentIdentity user agreed (at `login`) to attach their Claude
 *   account email; without it the device-scoped fallback is used even when
 *   the email is readable.
 * @param deviceSeed stable machine-scoped seed (e.g. hostname+username);
 *   only its hash ever leaves the machine.
 */
export function resolveLocalIdentity(
  homeDir: string,
  consentIdentity: boolean,
  deviceSeed: string,
): LocalIdentity {
  if (consentIdentity) {
    const oauth = readOauthEmail(homeDir);
    if (oauth) {
      return {
        descriptor: {
          kind: "person",
          externalId: oauth.email,
          email: oauth.email,
          displayName: oauth.displayName,
        },
        attribution: "person",
      };
    }
  }
  const hash = createHash("sha256").update(deviceSeed).digest("hex");
  return {
    descriptor: {
      kind: "account",
      externalId: `device:${hash.slice(0, 16)}`,
      email: null,
      displayName: null,
    },
    attribution: "account",
  };
}
