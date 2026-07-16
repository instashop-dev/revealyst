//! Per-record shape + counts primitives for the local feature extractor
//! (spec §7; plan T3.4; D-DA-5 = shape+counts only, NO prompt-text
//! classification).
//!
//! Two pure helpers, no I/O, no state:
//!
//! - [`count_text`] streams over a piece of prompt-like content the connector
//!   already has in hand, returns ONLY a character + word count, and lets the
//!   borrow end — the text is never copied out, stored, or forwarded. This is
//!   the ONE place prompt-like content is briefly in-process (spec §7.2). It is
//!   a length measurement, not classification: no substring is inspected, no
//!   keyword matched, nothing about the content survives except two integers.
//! - [`sanitize_model`] mirrors the CLI parser's `sanitizeModel`
//!   (`packages/revealyst-agent/src/parse.ts`): the model id is the only
//!   attacker-influenceable string that legitimately leaves the device, so it
//!   is charset-clamped to `[A-Za-z0-9._:-]` and capped at 64 scalar values
//!   BEFORE it can enter a payload — the extractor's candidate events therefore
//!   pass T3.3's `is_safe_sent_string` gate by construction.

/// Character + word counts derived by streaming over prompt-like content. The
/// content itself never leaves [`count_text`]; only these two numbers do
/// (spec §7.2, D-DA-5).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct TextCounts {
    /// Number of Unicode scalar values in the content.
    pub character_count: u64,
    /// Number of whitespace-delimited words in the content.
    pub word_count: u64,
}

/// Count Unicode scalar values and whitespace-delimited words in `content` in a
/// single streaming pass, then drop the borrow. Pure length measurement — the
/// content is never inspected for meaning, copied, stored, or returned
/// (D-DA-5: counts only, no classification).
pub fn count_text(content: &str) -> TextCounts {
    let mut character_count: u64 = 0;
    let mut word_count: u64 = 0;
    let mut in_word = false;
    for ch in content.chars() {
        character_count += 1;
        if ch.is_whitespace() {
            in_word = false;
        } else if !in_word {
            in_word = true;
            word_count += 1;
        }
    }
    TextCounts {
        character_count,
        word_count,
    }
}

/// The safe model-id charset (mirrors the CLI's `sanitizeModel` regex
/// `[^A-Za-z0-9._:-]`): ASCII alphanumerics plus `. _ : -`.
fn is_safe_model_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '-')
}

/// The upper bound on a sanitized model id, matching T3.3's `MAX_ENUM_LEN` and
/// the CLI's `slice(0, 64)`.
pub const MAX_MODEL_LEN: usize = 64;

/// Clamp a raw model id to the safe sent-string charset and length, collapsing
/// an empty/absent result to the `"unknown"` marker — byte-for-byte the CLI's
/// `sanitizeModel` behavior. The result is guaranteed ASCII-printable and
/// `<= MAX_MODEL_LEN` scalar values, so it passes T3.3's validator.
pub fn sanitize_model(raw: Option<&str>) -> String {
    let cleaned: String = match raw {
        None => String::new(),
        Some(s) => s
            .chars()
            .filter(|c| is_safe_model_char(*c))
            .take(MAX_MODEL_LEN)
            .collect(),
    };
    if cleaned.is_empty() {
        "unknown".to_string()
    } else {
        cleaned
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn count_text_counts_chars_and_words() {
        let c = count_text("hello world");
        assert_eq!(c.character_count, 11);
        assert_eq!(c.word_count, 2);
    }

    #[test]
    fn count_text_collapses_runs_of_whitespace() {
        // Leading/trailing/interior whitespace runs never inflate the word
        // count; every scalar value still counts toward the character count.
        let c = count_text("  a\t\tb\n c  ");
        assert_eq!(c.word_count, 3);
        assert_eq!(c.character_count, 11);
    }

    #[test]
    fn count_text_on_empty_is_zero() {
        let c = count_text("");
        assert_eq!(c, TextCounts::default());
    }

    #[test]
    fn count_text_counts_unicode_scalars_not_bytes() {
        // "café ☕" — 6 scalar values (é and ☕ are one scalar each), 2 words.
        let c = count_text("café ☕");
        assert_eq!(c.character_count, 6);
        assert_eq!(c.word_count, 2);
    }

    #[test]
    fn sanitize_model_keeps_a_clean_id() {
        assert_eq!(
            sanitize_model(Some("claude-haiku-4-5-20251001")),
            "claude-haiku-4-5-20251001"
        );
    }

    #[test]
    fn sanitize_model_strips_unsafe_chars() {
        // Spaces, slashes, and non-ASCII are dropped; the safe skeleton remains.
        assert_eq!(
            sanitize_model(Some("claude opus/4\u{202e}!")),
            "claudeopus4"
        );
        assert_eq!(sanitize_model(Some("gpt-4o")), "gpt-4o");
    }

    #[test]
    fn sanitize_model_absent_or_empty_is_unknown() {
        assert_eq!(sanitize_model(None), "unknown");
        assert_eq!(sanitize_model(Some("")), "unknown");
        // A string with no safe chars collapses to the marker, never empty.
        assert_eq!(sanitize_model(Some("   ")), "unknown");
        assert_eq!(sanitize_model(Some("★☕")), "unknown");
    }

    #[test]
    fn sanitize_model_caps_length() {
        let long = "a".repeat(200);
        let out = sanitize_model(Some(&long));
        assert_eq!(out.chars().count(), MAX_MODEL_LEN);
        assert!(out.is_ascii());
    }
}
