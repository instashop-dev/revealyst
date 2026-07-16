// W9-P4 (T4.1, GJ-007) — the capability curriculum. A static, capability-slug-
// keyed reference module mirroring the `capability-glossary.ts` pattern (the
// W7-2 exemplar): plain-English content, no DB write, no migration. Content
// lives in code — the inert `capabilities.learning_path` /
// `recommendation_catalog.learning_resources` columns stay inert (see
// docs/Revealyst_Closure_Execution_Plan.md §1 correction 2).
//
// Explicitly NOT an LMS (NOT-019, tripwire §2): there is no course, lesson,
// module, or certification structure, no progress tracking beyond the
// existing capability-state mastery read, and no XP/streak/badge/points
// mechanic. This is one ordered list of "what to try next" per capability,
// rendered from a detail drawer — never a second progress system. Every
// string here is a claim surface (invariant b): practical, honest, and never
// a promised outcome ("try this", not "this will improve your score").

/** One capability's curriculum entry. `howTo` is a short sequence of concrete
 * habits; `tryThis` is 2-3 immediately actionable prompts — things to attempt
 * today, not homework. */
export type CurriculumEntry = {
  /** 2-4 plain-English sentences: what this capability is and why it matters. */
  summary: string;
  /** 3-5 concrete habits/steps, ordered loosely easy-to-harder. */
  howTo: string[];
  /** 2-3 specific things to try right now. */
  tryThis: string[];
};

/**
 * Ordered slug sequence, mirroring the seed's `sort` column (10–90) in
 * `drizzle/0030_capability-graph.sql` — the same order `capabilities.list()`
 * returns. Kept here as a literal (not read from the DB) so this module stays
 * pure and dependency-free; `tests/capability-curriculum.test.ts` asserts it
 * stays a superset match against the live seed.
 */
export const CAPABILITY_CURRICULUM_ORDER: readonly string[] = [
  "ai-coding-foundations",
  "feature-breadth",
  "consistent-daily-use",
  "effective-prompting",
  "agentic-delivery",
  "cost-efficient-usage",
  "ship-with-ai",
  "code-review-with-ai",
  "model-selection",
];

export const CAPABILITY_CURRICULUM: Record<string, CurriculumEntry> = {
  "ai-coding-foundations": {
    summary:
      "This is about reaching for an AI coding tool as a normal habit, not a special occasion. The more it's part of your everyday flow, the more everything else on this list has room to build on.",
    howTo: [
      "Pick one recurring task you already do every day — writing tests, drafting a commit message, explaining an error — and route it through your AI tool first.",
      "Keep the tool open in a side panel or terminal tab so it's one click away instead of a context switch.",
      "Notice the moments you almost reach for it but don't — those are the real gaps to close.",
      "Give yourself permission to use it for small things too, not just big rewrites.",
    ],
    tryThis: [
      "Ask your AI tool to explain the next error message you hit before you search for it.",
      "Start tomorrow by asking it to summarize your open pull requests or diffs before you read them yourself.",
    ],
  },
  "feature-breadth": {
    summary:
      "Most AI coding tools offer more than a chat box — inline completions, an agent mode, code review, terminal help. Getting familiar with a few different ones means you can reach for whichever fits the task, instead of forcing everything through one channel.",
    howTo: [
      "List the features your current tool offers (autocomplete, chat, agent/edit mode, terminal help) and try each one at least once this week.",
      "Notice which feature felt fastest for which kind of task, and lean into that pairing.",
      "If a feature seems irrelevant to your work, ask a teammate how they use it before ruling it out.",
    ],
    tryThis: [
      "Let the tool edit a file directly instead of copy-pasting from a chat window.",
      "Ask it a question from your terminal instead of switching to a browser tab.",
    ],
  },
  "consistent-daily-use": {
    summary:
      "Growth compounds from steady use, not from one long session. Using an AI tool across most of your working days builds comfort and speed faster than a heavy day followed by a week of silence.",
    howTo: [
      "Set a simple personal rule: touch your AI tool at least once before lunch and once before you wrap up.",
      "Notice on days you skip it entirely, and ask yourself why — friction is usually fixable.",
      "Pair AI use with a task you already do daily, so it rides along instead of needing its own motivation.",
    ],
    tryThis: [
      "The next time you open your editor first thing, open your AI tool alongside it.",
      "On a day you'd normally skip it, ask it one quick question just to keep the habit going.",
    ],
  },
  "effective-prompting": {
    summary:
      "The gap between a suggestion you accept as-is and one you rewrite from scratch usually comes down to how much context you gave. Clearer asks get you closer answers, with less cleanup after.",
    howTo: [
      "Before asking, state the goal in one sentence, then any constraint — \"keep it under 20 lines\", \"match the existing style\".",
      "Point the tool at the specific file or function instead of describing it from memory.",
      "When a suggestion misses, say specifically what's wrong rather than just asking again.",
      "Reuse a prompt that worked well as a starting template next time.",
    ],
    tryThis: [
      "Rewrite your next request to include one concrete example of the output you want.",
      "On a task where the ask is vague, ask the tool to ask you a clarifying question first.",
    ],
  },
  "agentic-delivery": {
    summary:
      "Agent modes can carry a multi-step task end to end — read the code, make the change, run the tests — instead of you shepherding every step. Handing over more of the work, on tasks where you can still review the outcome, is worth practicing deliberately.",
    howTo: [
      "Start with a task you'd normally do in fifteen or twenty minutes and hand the whole thing to agent mode, then review the result.",
      "Give it the acceptance criteria up front — \"tests should pass\", \"don't touch the API\" — so it needs less back-and-forth.",
      "Review the diff before trusting it, the same way you'd review a teammate's pull request.",
      "Gradually hand over bigger tasks as you get a feel for what the agent handles well.",
    ],
    tryThis: [
      "Pick a small refactor or cleanup task and delegate it end-to-end.",
      "Ask the agent to write and run its own tests for a change, then check its work.",
    ],
  },
  "cost-efficient-usage": {
    summary:
      "Getting good value from AI spend usually means matching effort to the task — a quick question doesn't need the same model or session length as a big refactor.",
    howTo: [
      "Notice which tasks need a heavyweight session and which are quick lookups that don't.",
      "Close out sessions you're not actively using instead of leaving them running.",
      "Check whether your tool offers a lighter or cheaper mode for simple questions.",
    ],
    tryThis: [
      "Try a smaller or faster model for your next quick question and see if it's good enough.",
      "Batch a few related small questions into one session instead of starting fresh each time.",
    ],
  },
  "ship-with-ai": {
    summary:
      "The real signal isn't how much you chat with an AI tool — it's whether that help turns into commits and pull requests that ship. Closing the loop from suggestion to shipped change is the habit worth building.",
    howTo: [
      "After a productive AI session, make it a habit to commit the result the same day rather than letting it sit.",
      "Let the tool draft your commit message from the diff, then edit it for accuracy.",
      "Notice whether your AI-assisted changes are making it into pull requests, not just your working directory.",
    ],
    tryThis: [
      "Ask your AI tool to draft the pull-request description for your next change.",
      "Finish one AI-assisted change today by opening the pull request, not just writing the code.",
    ],
  },
  "code-review-with-ai": {
    summary:
      "AI tools can catch things a first read misses — edge cases, inconsistent naming, missing tests — before a human reviewer spends time on them.",
    howTo: [
      "Run your AI tool over a diff before requesting human review, and fix what it flags first.",
      "Ask it to review someone else's pull request alongside your own read, then compare notes.",
      "Use it to explain an unfamiliar part of a change you're reviewing, not just to find bugs.",
    ],
    tryThis: [
      "Paste your next diff into your AI tool and ask what a careful reviewer would flag.",
      "Ask it to check a pull request for missing test coverage before you approve it.",
    ],
  },
  "model-selection": {
    summary:
      "Different models trade off speed, cost, and depth. Choosing deliberately, instead of always defaulting to whatever's already open, means you're not overpaying for simple tasks or underpowered for hard ones.",
    howTo: [
      "Learn which models your tool offers and roughly what each is good at — fast and cheap versus deep and careful.",
      "Reach for a faster model for quick lookups and a stronger one for tricky or high-stakes changes.",
      "Notice when a suggestion feels shallow, and try switching models before giving up on the approach.",
    ],
    tryThis: [
      "Try your next tricky bug with a different model than you'd normally reach for.",
      "Use the fastest available model for your next simple, low-stakes question.",
    ],
  },
};

/** Plain-English drawer copy. No LMS vocabulary (course/lesson/module/
 * certification) and no gamification vocabulary (XP/streak/badge/points) —
 * both swept by `tests/capability-curriculum.test.ts`. */
export const CAPABILITY_CURRICULUM_COPY = {
  /** The opt-in link on the profile card's next-focus line. */
  triggerLabel: "See how to grow this",
  /** Drawer title lead — rendered as `${titleLead} ${label}`. */
  titleLead: "Growing:",
  drawerDescription:
    "A few concrete things to try, drawn from what this capability is about — not a checklist to finish, just ideas to pick up when you want them.",
  howToLabel: "How to grow this",
  tryThisLabel: "Try this",
  pathLabel: "Where this sits in the path",
  pathDescription:
    "The capabilities in this list build on the ones before them. There's no deadline and nothing to complete — it's just a sequence, so you can see what usually comes next.",
} as const;
