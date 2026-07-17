// Persona definitions for the rich demo seed (README.md's data narrative).
// PURE data — no dates, no randomness resolved here; activity.ts turns these
// into day-by-day metric_records/signals against an explicit anchorDay.

/** Acme Robotics connector keys — mirrors FixtureGraph connections[].key for
 * the 5 healthy connections (the 2 unhealthy ones, `openai_legacy` and
 * `cursor_sandbox`, never carry subjects/records). */
export type AcmeVendorKey =
  | "anthropic"
  | "cursor"
  | "copilot"
  | "openai"
  | "claude_code_local";

export type ActivityBand =
  | "power"
  | "regular"
  | "moderate"
  | "occasional"
  | "new_joiner"
  | "churned"
  | "unsegmented";

/**
 * Segmented day-count targets activity.ts uses to place active days:
 * - currentMonthActiveDays: within [monthStart(anchor), anchorDay].
 * - trailing28ActiveDays: within the trailing 28-day window ending anchorDay
 *   (>= currentMonthActiveDays; the remainder lands earlier in that window).
 * - historyWeeklyActiveDays: typical active days per COMPLETE week for the
 *   13 weeks before the trailing-28 window — ramped over time by activity.ts
 *   (low early, high late) to drive the attribution-mix / agentic-adoption
 *   trends without each persona needing its own trend logic.
 * - activeSince/activeUntil: eligibility bounds (new joiner / churned).
 */
/** Engineering-role slug from the GLOBAL `roles` reference table (mig 0026)
 * — the seed assigns one per person via SeedOrgPlan.roleAssignments. */
export type RoleSlug =
  | "backend"
  | "frontend"
  | "fullstack"
  | "mobile"
  | "platform"
  | "data"
  | "ml"
  | "sre";

export type AcmePersona = {
  key: string;
  pseudonym: string;
  team: "platform" | "product_eng" | "data";
  band: ActivityBand;
  /** Engineering role (tests pin every value against the seeded `roles`
   * table, so a slug typo fails loudly rather than at FK time). */
  role: RoleSlug;
  vendors: readonly AcmeVendorKey[];
  currentMonthActiveDays: number;
  trailing28ActiveDays: number;
  historyWeeklyActiveDays: number;
  /** Days before anchorDay; null = eligible from the start of the window. */
  activeSinceDaysBeforeAnchor: number | null;
  /** Days before anchorDay; null = eligible through anchorDay. */
  activeUntilDaysBeforeAnchor: number | null;
};

// 14 people / 3 teams. Vendor choice per team is deliberate (see README +
// CLAUDE.md scenario targets):
//  - Platform runs Cursor exclusively → carries the "newlyUnmeasured"
//    suggestions_offered gap in the current month.
//  - Product Eng runs Copilot (+ one Anthropic/Cursor/local power user) →
//    carries the fluency-drop (suggestions acceptance collapse) scenario.
//  - Data runs OpenAI exclusively → OpenAI's single feature dim
//    (feature=interactive_api) and low current-month density is the
//    engineered "coaching weak" team.
export const ACME_PEOPLE: readonly AcmePersona[] = [
  {
    key: "brisk-falcon",
    pseudonym: "brisk-falcon",
    role: "platform",
    team: "platform",
    band: "power",
    vendors: ["anthropic", "cursor", "claude_code_local"],
    currentMonthActiveDays: 9,
    trailing28ActiveDays: 26,
    historyWeeklyActiveDays: 5,
    activeSinceDaysBeforeAnchor: null,
    activeUntilDaysBeforeAnchor: null,
  },
  {
    key: "amber-lynx",
    pseudonym: "amber-lynx",
    role: "fullstack",
    team: "product_eng",
    band: "power",
    // copilot + anthropic + openai = 6 distinct feature dims (completion,
    // chat, cli, agent, claude_code, interactive_api) — the only vendor
    // combo that reaches an ai_native (≥75) adoption band inside a PARTIAL
    // current month (10 elapsed days = 25pts + 6/6 dims = 50pts = 75.0)
    // without emitting suggestions (anthropic/openai never do), so Product
    // Eng's copilot-driven acceptance collapse stays undiluted.
    vendors: ["copilot", "anthropic", "openai"],
    currentMonthActiveDays: 10,
    trailing28ActiveDays: 27,
    historyWeeklyActiveDays: 5,
    activeSinceDaysBeforeAnchor: null,
    activeUntilDaysBeforeAnchor: null,
  },
  {
    key: "quiet-otter",
    pseudonym: "quiet-otter",
    role: "backend",
    team: "platform",
    band: "regular",
    vendors: ["cursor"],
    currentMonthActiveDays: 5,
    trailing28ActiveDays: 18,
    historyWeeklyActiveDays: 4,
    activeSinceDaysBeforeAnchor: null,
    activeUntilDaysBeforeAnchor: null,
  },
  {
    key: "gilded-heron",
    pseudonym: "gilded-heron",
    role: "frontend",
    team: "product_eng",
    band: "regular",
    vendors: ["copilot"],
    currentMonthActiveDays: 5,
    trailing28ActiveDays: 15,
    historyWeeklyActiveDays: 3,
    activeSinceDaysBeforeAnchor: null,
    activeUntilDaysBeforeAnchor: null,
  },
  {
    key: "mellow-badger",
    pseudonym: "mellow-badger",
    role: "frontend",
    team: "product_eng",
    band: "regular",
    vendors: ["copilot"],
    currentMonthActiveDays: 6,
    trailing28ActiveDays: 21,
    historyWeeklyActiveDays: 4,
    activeSinceDaysBeforeAnchor: null,
    activeUntilDaysBeforeAnchor: null,
  },
  {
    key: "placid-egret",
    pseudonym: "placid-egret",
    role: "mobile",
    team: "product_eng",
    band: "regular",
    vendors: ["openai"],
    currentMonthActiveDays: 5,
    trailing28ActiveDays: 19,
    historyWeeklyActiveDays: 4,
    activeSinceDaysBeforeAnchor: null,
    activeUntilDaysBeforeAnchor: null,
  },
  {
    key: "dusky-marten",
    pseudonym: "dusky-marten",
    role: "sre",
    team: "platform",
    band: "moderate",
    vendors: ["cursor"],
    currentMonthActiveDays: 4,
    trailing28ActiveDays: 14,
    historyWeeklyActiveDays: 2,
    activeSinceDaysBeforeAnchor: null,
    activeUntilDaysBeforeAnchor: null,
  },
  {
    key: "sable-wren",
    pseudonym: "sable-wren",
    role: "data",
    team: "data",
    band: "moderate",
    vendors: ["openai"],
    currentMonthActiveDays: 2,
    trailing28ActiveDays: 8,
    historyWeeklyActiveDays: 2,
    activeSinceDaysBeforeAnchor: null,
    activeUntilDaysBeforeAnchor: null,
  },
  {
    key: "hushed-vole",
    pseudonym: "hushed-vole",
    role: "data",
    team: "data",
    band: "moderate",
    vendors: ["openai"],
    currentMonthActiveDays: 2,
    trailing28ActiveDays: 11,
    historyWeeklyActiveDays: 2,
    activeSinceDaysBeforeAnchor: null,
    activeUntilDaysBeforeAnchor: null,
  },
  {
    key: "faded-ibis",
    pseudonym: "faded-ibis",
    role: "platform",
    team: "platform",
    band: "occasional",
    vendors: ["cursor"],
    currentMonthActiveDays: 2,
    trailing28ActiveDays: 6,
    historyWeeklyActiveDays: 1,
    activeSinceDaysBeforeAnchor: null,
    activeUntilDaysBeforeAnchor: null,
  },
  {
    key: "muted-shrew",
    pseudonym: "muted-shrew",
    role: "ml",
    team: "data",
    band: "occasional",
    vendors: ["openai"],
    currentMonthActiveDays: 2,
    trailing28ActiveDays: 3,
    historyWeeklyActiveDays: 1,
    activeSinceDaysBeforeAnchor: null,
    activeUntilDaysBeforeAnchor: null,
  },
  {
    key: "vernal-finch",
    pseudonym: "vernal-finch",
    role: "backend",
    team: "platform",
    band: "new_joiner",
    vendors: ["cursor"],
    currentMonthActiveDays: 6,
    trailing28ActiveDays: 7,
    historyWeeklyActiveDays: 0,
    activeSinceDaysBeforeAnchor: 10,
    activeUntilDaysBeforeAnchor: null,
  },
  {
    key: "wistful-stoat",
    pseudonym: "wistful-stoat",
    role: "fullstack",
    team: "product_eng",
    band: "churned",
    vendors: ["copilot"],
    currentMonthActiveDays: 0,
    trailing28ActiveDays: 0,
    historyWeeklyActiveDays: 3,
    activeSinceDaysBeforeAnchor: null,
    // Silent for the trailing 35 days AND all of the current + previous
    // month — activity.ts clamps this further against prevMonth.start.
    activeUntilDaysBeforeAnchor: 35,
  },
  {
    key: "idle-newt",
    pseudonym: "idle-newt",
    role: "data",
    team: "data",
    band: "unsegmented",
    vendors: [],
    currentMonthActiveDays: 0,
    trailing28ActiveDays: 0,
    historyWeeklyActiveDays: 0,
    activeSinceDaysBeforeAnchor: null,
    activeUntilDaysBeforeAnchor: null,
  },
];

export const ACME_TEAMS: readonly {
  key: "platform" | "product_eng" | "data";
  name: string;
}[] = [
  { key: "platform", name: "Platform" },
  { key: "product_eng", name: "Product Eng" },
  { key: "data", name: "Data" },
];

export const ACME_EMAIL_DOMAIN = "acme-robotics.example";

// --- Jordan Lee (personal org) --------------------------------------------

export const JORDAN_KEY = "jordan";
export const JORDAN_PSEUDONYM = "solo-fox";
export const JORDAN_EMAIL = "jordan.lee@personal.example";

// --- Globex Pilot (small team, over budget) --------------------------------

export type GlobexPersona = {
  key: string;
  pseudonym: string;
  currentMonthActiveDays: number;
  trailing28ActiveDays: number;
  historyWeeklyActiveDays: number;
};

export const GLOBEX_EMAIL_DOMAIN = "globex-pilot.example";

export const GLOBEX_PEOPLE: readonly GlobexPersona[] = [
  {
    key: "coral-tern",
    pseudonym: "coral-tern",
    currentMonthActiveDays: 6,
    trailing28ActiveDays: 20,
    historyWeeklyActiveDays: 3,
  },
  {
    key: "umber-lynx",
    pseudonym: "umber-lynx",
    currentMonthActiveDays: 4,
    trailing28ActiveDays: 13,
    historyWeeklyActiveDays: 2,
  },
  {
    key: "pale-wren",
    pseudonym: "pale-wren",
    currentMonthActiveDays: 3,
    trailing28ActiveDays: 9,
    historyWeeklyActiveDays: 2,
  },
];
