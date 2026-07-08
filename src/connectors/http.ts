import { RetryableConnectorError } from "../poller/run";

// Shared across all connector clients (unlike CALL_SPACING_MS/sleep, which
// stay per-file — those are trivial, vendor-tunable numbers built by
// separate workstreams; this is 20+ lines of control flow with zero
// vendor-specific behavior beyond a label, so duplicating it three times
// just risks a partial fix landing in one connector and not the others).

/** Bounds an entire vendor call — connect, headers, AND body read — so a
 * stalled or slow-body response can't hang an awaiting caller forever (this
 * bit onboarding: credential save awaits validateAuth synchronously). `op`
 * receives the AbortSignal to pass into fetch so a real stall cancels its
 * underlying connection; the race also guarantees the bound holds even
 * against a fetch impl that ignores the signal (e.g. a test double).
 * Timeout is retryable, like 429/5xx — a stall is transient, not a
 * definitive rejection. */
export const FETCH_TIMEOUT_MS = 15_000;

export function withTimeout<T>(
  label: string,
  op: (signal: AbortSignal) => Promise<T>,
  ms: number = FETCH_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new RetryableConnectorError(
          `${label}: request timed out after ${ms}ms`,
          60,
        ),
      );
    }, ms);
  });
  const call = op(controller.signal);
  call.catch(() => {}); // avoid an unhandled rejection if this loses the race
  return Promise.race([call, timeout]).finally(() => clearTimeout(timer));
}
