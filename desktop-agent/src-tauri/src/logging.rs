//! Structured logging (spec §23.1).
//!
//! JSON lines to the platform log dir, one file per day, files older than 7
//! days deleted on startup. Logs may include timestamp / level / component /
//! error code (and later connector id, retry count, queue count, sync
//! status). Logs must NEVER include prompt text, response text, tokens,
//! keys, cookies, file contents, or clipboard contents — anything secret-ish
//! is wrapped in [`Redact`] from day one so it CANNOT be printed.

use std::fmt;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// File-name prefix for the daily log files (tracing-appender names them
/// `PREFIX.YYYY-MM-DD`).
pub const LOG_FILE_PREFIX: &str = "revealyst-agent.log";

/// Log files older than this many days are deleted on startup.
pub const MAX_LOG_AGE_DAYS: i64 = 7;

/// Newtype that makes a value unprintable: both `Display` and `Debug` always
/// yield `[redacted]`, so a secret wrapped at the source can never leak into
/// a log line, error message, or panic — even via `{:?}` (spec §23.1).
pub struct Redact<T>(pub T);

impl<T> fmt::Display for Redact<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[redacted]")
    }
}

impl<T> fmt::Debug for Redact<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[redacted]")
    }
}

/// Keeps the non-blocking log writer alive for the life of the app.
/// Dropped on exit, which flushes pending lines.
pub struct LogGuard(pub tracing_appender::non_blocking::WorkerGuard);

/// Initialize JSON logging into `log_dir` and sweep expired files.
/// Returns the guard that must be kept alive (manage it on the app).
pub fn init_logging(log_dir: &Path) -> Option<LogGuard> {
    let _ = std::fs::create_dir_all(log_dir);
    sweep_old_logs(log_dir);

    let appender = tracing_appender::rolling::daily(log_dir, LOG_FILE_PREFIX);
    let (writer, guard) = tracing_appender::non_blocking(appender);

    let initialized = tracing_subscriber::fmt()
        .json()
        .with_writer(writer)
        .with_ansi(false)
        .try_init()
        .is_ok();

    if initialized {
        tracing::info!(component = "logging", "structured logging started");
        Some(LogGuard(guard))
    } else {
        // A subscriber was already set (e.g. in tests) — nothing to guard.
        None
    }
}

/// Delete daily log files older than [`MAX_LOG_AGE_DAYS`]. Only files whose
/// name is exactly `PREFIX.YYYY-MM-DD` are touched — anything unparseable is
/// left alone (never delete what we can't positively identify as ours).
pub fn sweep_old_logs(log_dir: &Path) {
    let today = days_since_epoch_today();
    let Ok(entries) = std::fs::read_dir(log_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if should_delete_log(name, LOG_FILE_PREFIX, today, MAX_LOG_AGE_DAYS) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// Pure sweep predicate: `true` iff `file_name` is `PREFIX.YYYY-MM-DD` and
/// that date is more than `max_age_days` days before `today_days`
/// (days since the Unix epoch).
pub fn should_delete_log(
    file_name: &str,
    prefix: &str,
    today_days: i64,
    max_age_days: i64,
) -> bool {
    let Some(file_days) = parse_log_file_days(file_name, prefix) else {
        return false;
    };
    today_days - file_days > max_age_days
}

/// Parse `PREFIX.YYYY-MM-DD` into days since the Unix epoch.
fn parse_log_file_days(file_name: &str, prefix: &str) -> Option<i64> {
    let rest = file_name.strip_prefix(prefix)?.strip_prefix('.')?;
    let mut parts = rest.split('-');
    let year: i64 = parts.next()?.parse().ok()?;
    let month: i64 = parts.next()?.parse().ok()?;
    let day: i64 = parts.next()?.parse().ok()?;
    if parts.next().is_some() || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    Some(days_from_civil(year, month, day))
}

/// Days since 1970-01-01 for a proleptic-Gregorian civil date
/// (Howard Hinnant's `days_from_civil` algorithm; no date crate needed).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400; // [0, 399]
    let mp = if m > 2 { m - 3 } else { m + 9 }; // [0, 11], March = 0
    let doy = (153 * mp + 2) / 5 + d - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146097 + doe - 719468
}

fn days_since_epoch_today() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| (d.as_secs() / 86_400) as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::{Arc, Mutex};

    #[test]
    fn redact_display_and_debug_both_yield_redacted() {
        let secret = Redact(String::from("rva1.super-secret-token"));
        assert_eq!(format!("{secret}"), "[redacted]");
        assert_eq!(format!("{secret:?}"), "[redacted]");
        // Works for any inner type, including ones with a chatty Debug.
        let structured = Redact(vec!["api-key", "refresh-token"]);
        assert_eq!(format!("{structured:?}"), "[redacted]");
    }

    /// A `MakeWriter` that captures log output for assertions.
    #[derive(Clone, Default)]
    struct Capture(Arc<Mutex<Vec<u8>>>);

    impl Write for Capture {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for Capture {
        type Writer = Capture;
        fn make_writer(&'a self) -> Capture {
            self.clone()
        }
    }

    #[test]
    fn json_line_carries_component_and_never_the_secret() {
        let capture = Capture::default();
        let subscriber = tracing_subscriber::fmt()
            .json()
            .with_writer(capture.clone())
            .with_ansi(false)
            .finish();

        tracing::subscriber::with_default(subscriber, || {
            let token = Redact(String::from("rva1.super-secret-token"));
            tracing::info!(
                component = "sync",
                error_code = "none",
                token = %token,
                "sample event"
            );
        });

        let bytes = capture.0.lock().unwrap().clone();
        let line = String::from_utf8(bytes).expect("log output is UTF-8");
        let json: serde_json::Value =
            serde_json::from_str(line.lines().next().expect("one JSON line"))
                .expect("log line is valid JSON");

        // Required structure: timestamp + level + our fields.
        assert!(json.get("timestamp").is_some(), "timestamp present: {line}");
        assert_eq!(json["level"], "INFO");
        let fields = &json["fields"];
        assert_eq!(fields["component"], "sync");
        assert_eq!(fields["error_code"], "none");
        // The redacted value is redacted, and the raw secret appears nowhere.
        assert_eq!(fields["token"], "[redacted]");
        assert!(
            !line.contains("super-secret-token"),
            "raw secret must never appear in a log line: {line}"
        );
    }

    #[test]
    fn days_from_civil_matches_known_dates() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(1970, 1, 2), 1);
        assert_eq!(days_from_civil(2000, 1, 1), 10_957);
        // Leap-day handling.
        assert_eq!(
            days_from_civil(2024, 3, 1) - days_from_civil(2024, 2, 28),
            2
        );
    }

    #[test]
    fn sweep_predicate_deletes_only_expired_own_files() {
        let today = days_from_civil(2026, 7, 16);
        let p = LOG_FILE_PREFIX;

        // Exactly 7 days old: kept (only STRICTLY older is deleted).
        assert!(!should_delete_log(&format!("{p}.2026-07-09"), p, today, 7));
        // 8 days old: deleted.
        assert!(should_delete_log(&format!("{p}.2026-07-08"), p, today, 7));
        // Today: kept.
        assert!(!should_delete_log(&format!("{p}.2026-07-16"), p, today, 7));
        // Future-dated (clock skew): kept.
        assert!(!should_delete_log(&format!("{p}.2026-08-01"), p, today, 7));
        // Not our prefix: never touched, however old.
        assert!(!should_delete_log("other.log.2020-01-01", p, today, 7));
        // Unparseable dates: never touched.
        assert!(!should_delete_log(&format!("{p}.not-a-date"), p, today, 7));
        assert!(!should_delete_log(&format!("{p}.2020-13-01"), p, today, 7));
        assert!(!should_delete_log(&format!("{p}.2020-01-99"), p, today, 7));
        assert!(!should_delete_log(
            &format!("{p}.2020-01-01-extra"),
            p,
            today,
            7
        ));
        assert!(!should_delete_log(p, p, today, 7));
    }

    #[test]
    fn sweep_old_logs_removes_expired_files_and_leaves_the_rest() {
        let dir =
            std::env::temp_dir().join(format!("revealyst-log-sweep-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let old = dir.join(format!("{LOG_FILE_PREFIX}.2000-01-01"));
        let foreign = dir.join("keep-me.txt");
        std::fs::write(&old, b"old").unwrap();
        std::fs::write(&foreign, b"foreign").unwrap();

        sweep_old_logs(&dir);

        assert!(!old.exists(), "expired log file must be deleted");
        assert!(foreign.exists(), "foreign files must never be touched");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
