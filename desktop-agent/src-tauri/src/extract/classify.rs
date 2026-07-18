//! On-device work-type classifier (Recommendation #9; D-DA-5; ADR 0055 / 0059).
//!
//! This is the FIRST place the resident desktop agent reads prompt content for
//! *meaning* — `count_text` only measured length. It mirrors `count_text`'s
//! borrow-and-drop discipline exactly: it borrows the `&str` the extractor
//! already holds, derives a bounded result, and lets the borrow end. **No
//! substring is stored, copied, logged, forwarded, or returned.** The only
//! things that leave these functions are a closed-enum [`TaskCategory`] and two
//! booleans.
//!
//! ## Why this is structurally content-free
//!
//! - **Closed-Rust-enum return type.** [`classify_prompt`] returns
//!   [`TaskCategory`] — a fixed enum whose variants each map to one short, ASCII,
//!   lowercase label. There is **no code path** by which a raw or free-form
//!   string becomes the emitted label; anything unclassifiable is
//!   [`TaskCategory::Other`] (the mandatory catch-all, ADR 0055 §2.2), never the
//!   text. The refinement/verification detectors return `bool`.
//! - **No copy of the content.** Matching is done with [`contains_ci`], a byte-
//!   window ASCII-case-insensitive scan that allocates NOTHING from the content
//!   (unlike `to_lowercase`, which would copy the whole prompt). The content is
//!   borrowed, scanned, and dropped.
//! - **Deterministic heuristics only.** A fixed keyword/priority table — no cloud
//!   call, no network, no ML model (DA-FEAT-003; the ML classifier stays deferred
//!   until heuristics prove insufficient). Same input → same output.
//!
//! ## Confidence ceiling
//!
//! The three `worktype` keys these feed are NOT OTel markers (ADR 0039), so a
//! capability bound to them caps at `directional`, never `measured`. Nothing
//! here changes that. And per ADR 0055 §5 the classification is an uncalibrated
//! directional proxy of "did AI work of this kind", not a calibrated mastery.

/// The CLOSED work-type enum the classifier maps each prompt to. Mirrors the
/// frozen `TASK_CATEGORY_IDS` contract (`src/contracts/metrics.ts`), crossed to
/// this crate through the generated allowlist artifact (`closedEnums`
/// `.task_category`) so the device validator checks against the exact contract
/// set. [`as_str`](TaskCategory::as_str) is the ONLY string this type yields, and
/// it is always one of the fixed labels — never prompt text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum TaskCategory {
    Research,
    Ideation,
    Drafting,
    Summarization,
    Analysis,
    Review,
    Coding,
    Planning,
    /// The mandatory catch-all — anything unclassifiable falls here, so the
    /// classifier never needs a free-string escape hatch (ADR 0055 §2.2).
    Other,
}

impl TaskCategory {
    /// The closed-enum wire label — one of the fixed `TASK_CATEGORY_IDS` strings.
    /// This is the only string a `TaskCategory` can produce; it can never carry a
    /// substring of a prompt.
    pub fn as_str(self) -> &'static str {
        match self {
            TaskCategory::Research => "research",
            TaskCategory::Ideation => "ideation",
            TaskCategory::Drafting => "drafting",
            TaskCategory::Summarization => "summarization",
            TaskCategory::Analysis => "analysis",
            TaskCategory::Review => "review",
            TaskCategory::Coding => "coding",
            TaskCategory::Planning => "planning",
            TaskCategory::Other => "other",
        }
    }
}

/// ASCII-case-insensitive substring test that allocates NOTHING from `haystack`
/// (no lowercase copy of the prompt content). `needle` MUST be ASCII lowercase
/// (all keyword-table needles are). Returns `false` for an empty or too-long
/// needle. Byte-window scan — the content is only read, never copied out.
fn contains_ci(haystack: &str, needle: &str) -> bool {
    let hay = haystack.as_bytes();
    let nee = needle.as_bytes();
    if nee.is_empty() || nee.len() > hay.len() {
        return false;
    }
    hay.windows(nee.len())
        .any(|window| window.eq_ignore_ascii_case(nee))
}

/// True if `content` contains ANY of `needles` (ASCII case-insensitive).
fn contains_any(content: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| contains_ci(content, needle))
}

/// Ordered keyword table: each `(category, needles)` pair is tried in order and
/// the FIRST category with a matching needle wins, so more specific categories
/// come first. A prompt matching none falls to [`TaskCategory::Other`]. The
/// needles are distinctive lowercase cues; this is a directional heuristic
/// (ADR 0055 §5), not a calibrated classifier — precision is not the point.
const CATEGORY_TABLE: &[(TaskCategory, &[&str])] = &[
    (
        TaskCategory::Coding,
        &[
            "code",
            "function",
            "debug",
            "compile",
            "refactor",
            "stack trace",
            "stacktrace",
            "syntax error",
            "implement",
            "typescript",
            "javascript",
            "python",
            "regex",
            "traceback",
            "null pointer",
            "segfault",
        ],
    ),
    (
        TaskCategory::Summarization,
        &[
            "summarize",
            "summarise",
            "summary",
            "tl;dr",
            "tldr",
            "condense",
            "recap",
            "key points",
            "key takeaways",
        ],
    ),
    (
        TaskCategory::Review,
        &[
            "review",
            "feedback",
            "critique",
            "proofread",
            "what's wrong",
            "whats wrong",
            "any mistakes",
        ],
    ),
    (
        TaskCategory::Analysis,
        &[
            "analyze",
            "analyse",
            "compare",
            "evaluate",
            "assess",
            "pros and cons",
            "trade-off",
            "tradeoff",
            "root cause",
            "breakdown of",
        ],
    ),
    (
        TaskCategory::Planning,
        &[
            "plan",
            "roadmap",
            "schedule",
            "outline",
            "steps to",
            "organize",
            "organise",
            "break down",
            "milestones",
            "prioritize",
            "prioritise",
        ],
    ),
    (
        TaskCategory::Research,
        &[
            "research",
            "find out",
            "look up",
            "what is",
            "what are",
            "how does",
            "explain",
            "learn about",
            "tell me about",
        ],
    ),
    (
        TaskCategory::Ideation,
        &[
            "brainstorm",
            "ideas",
            "come up with",
            "suggest",
            "name ideas",
            "possible names",
        ],
    ),
    (
        TaskCategory::Drafting,
        &[
            "write",
            "draft",
            "compose",
            "email",
            "blog post",
            "rewrite",
            "create a",
            "generate a",
            "paragraph",
        ],
    ),
];

/// Classify one prompt into the closed [`TaskCategory`] enum, ON-DEVICE and
/// borrow-and-drop. `content` is borrowed, scanned against [`CATEGORY_TABLE`]
/// (first match wins), and dropped — no substring is stored, copied, or
/// returned. Anything unclassifiable is [`TaskCategory::Other`], never raw text.
pub fn classify_prompt(content: &str) -> TaskCategory {
    for (category, needles) in CATEGORY_TABLE {
        if contains_any(content, needles) {
            return *category;
        }
    }
    TaskCategory::Other
}

/// Cues that a prompt refines/revises an earlier answer (a follow-up turn).
const REFINEMENT_NEEDLES: &[&str] = &[
    "instead",
    "rather",
    "revise",
    "redo",
    "try again",
    "make it",
    "shorter",
    "longer",
    "more concise",
    "reword",
    "rephrase",
    "adjust",
    "not quite",
    "actually,",
    "can you also",
    "add more",
    "simplify",
    "tweak",
];

/// True if `content` looks like a refinement/follow-up turn (borrow-and-drop;
/// returns only a `bool`). Feeds the per-day `iteration_depth` count.
pub fn is_refinement_turn(content: &str) -> bool {
    contains_any(content, REFINEMENT_NEEDLES)
}

/// Cues that a prompt asks to CHECK the AI's output (verify, cite, test,
/// confirm).
const VERIFICATION_NEEDLES: &[&str] = &[
    "verify",
    "double-check",
    "double check",
    "are you sure",
    "is that correct",
    "is this correct",
    "fact-check",
    "fact check",
    "cite",
    "citation",
    "source",
    "prove",
    "confirm",
    "make sure",
    "test this",
    "add a test",
    "write a test",
];

/// True if `content` looks like a verification action (borrow-and-drop; returns
/// only a `bool`). Feeds the per-day `verification_behavior` count.
pub fn is_verification_action(content: &str) -> bool {
    contains_any(content, VERIFICATION_NEEDLES)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn category_labels_match_the_closed_contract_set() {
        // Every variant's label is one of the frozen TASK_CATEGORY_IDS, and the
        // set is exactly the nine (contract parity is also pinned on the TS side
        // by the drift test; this is the device-local half).
        let mut labels: Vec<&str> = [
            TaskCategory::Research,
            TaskCategory::Ideation,
            TaskCategory::Drafting,
            TaskCategory::Summarization,
            TaskCategory::Analysis,
            TaskCategory::Review,
            TaskCategory::Coding,
            TaskCategory::Planning,
            TaskCategory::Other,
        ]
        .iter()
        .map(|c| c.as_str())
        .collect();
        labels.sort_unstable();
        assert_eq!(
            labels,
            vec![
                "analysis",
                "coding",
                "drafting",
                "ideation",
                "other",
                "planning",
                "research",
                "review",
                "summarization",
            ]
        );
        // Every label is short, ASCII, lowercase — safe as a metric label by
        // construction (well within the validator's MAX_ENUM_LEN of 64).
        for label in labels {
            assert!(label.is_ascii() && label.chars().count() <= 64);
            assert_eq!(label, label.to_ascii_lowercase());
        }
    }

    #[test]
    fn classifies_representative_prompts() {
        assert_eq!(
            classify_prompt("Please refactor this function and fix the bug"),
            TaskCategory::Coding
        );
        assert_eq!(
            classify_prompt("Summarize this article in three bullets"),
            TaskCategory::Summarization
        );
        assert_eq!(
            classify_prompt("Review my essay and give feedback"),
            TaskCategory::Review
        );
        assert_eq!(
            classify_prompt("Compare these two vendors and their trade-offs"),
            TaskCategory::Analysis
        );
        assert_eq!(
            classify_prompt("Draft a roadmap with the steps to launch"),
            TaskCategory::Planning
        );
        assert_eq!(
            classify_prompt("What is retrieval-augmented generation?"),
            TaskCategory::Research
        );
        assert_eq!(
            classify_prompt("Brainstorm ideas for a product name"),
            TaskCategory::Ideation
        );
        assert_eq!(
            classify_prompt("Write a friendly email to the team"),
            TaskCategory::Drafting
        );
    }

    #[test]
    fn matching_is_case_insensitive() {
        assert_eq!(
            classify_prompt("SUMMARIZE THIS PLEASE"),
            TaskCategory::Summarization
        );
        assert_eq!(classify_prompt("ReFaCtOr the CODE"), TaskCategory::Coding);
    }

    #[test]
    fn unclassifiable_prompt_falls_to_other_never_text() {
        // A content-rich prompt with no keyword match classifies to `other` — the
        // label is the fixed enum string, NOT any part of the input. (The phrase
        // is deliberately free of every CATEGORY_TABLE needle — e.g. "moniker"
        // rather than "codename", which would incidentally contain "code".)
        let secret = "zzqwx blarf yonk the confidential launch moniker";
        let category = classify_prompt(secret);
        assert_eq!(category, TaskCategory::Other);
        // The only thing that leaves is the enum label, which shares no substring
        // with the input beyond incidental letters — and structurally it is a
        // fixed constant, never a slice of `secret`.
        assert_eq!(category.as_str(), "other");
        assert!(!secret.contains(category.as_str()));
    }

    #[test]
    fn classification_never_returns_a_substring_of_the_input() {
        // Adversarial: feed prompts that literally contain each category label as
        // free text, and prove the RESULT is a fixed &'static str, not a borrow of
        // the input. (Pointer identity: the label can never point into `content`.)
        for probe in [
            "analysis of the coding review plan",
            "please research and summarize and draft this",
            "ideation other planning verify cite",
        ] {
            let cat = classify_prompt(probe);
            let label = cat.as_str();
            // The label is 'static — it does not borrow `probe`.
            let label_ptr = label.as_ptr() as usize;
            let probe_start = probe.as_ptr() as usize;
            let probe_end = probe_start + probe.len();
            assert!(
                label_ptr < probe_start || label_ptr >= probe_end,
                "the label must be a 'static constant, never a slice of the prompt"
            );
        }
    }

    #[test]
    fn detects_refinement_turns() {
        assert!(is_refinement_turn("make it shorter please"));
        assert!(is_refinement_turn("Actually, try again but simpler"));
        assert!(is_refinement_turn("reword this paragraph"));
        assert!(!is_refinement_turn("what is the capital of France"));
    }

    #[test]
    fn detects_verification_actions() {
        assert!(is_verification_action("can you verify this is correct"));
        assert!(is_verification_action("please cite a source"));
        assert!(is_verification_action("add a test for this function"));
        assert!(is_verification_action("double-check the math"));
        assert!(!is_verification_action("write me a poem"));
    }

    #[test]
    fn contains_ci_allocates_nothing_and_is_bounded() {
        assert!(contains_ci("Hello WORLD", "world"));
        assert!(!contains_ci("hi", "longer than the haystack"));
        assert!(!contains_ci("anything", ""));
        // Non-ASCII content is scanned safely (bytes compared; no panic).
        assert!(!contains_ci("café ☕ zürich", "coding"));
        assert!(contains_ci("run the CODE", "code"));
    }

    #[test]
    fn is_deterministic() {
        let p = "Refactor this function, then verify it with a test";
        assert_eq!(classify_prompt(p), classify_prompt(p));
        assert_eq!(is_refinement_turn(p), is_refinement_turn(p));
        assert_eq!(is_verification_action(p), is_verification_action(p));
    }
}
