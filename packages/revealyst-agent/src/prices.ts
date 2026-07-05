// Public list prices used for spend_cents_estimated — an ESTIMATE, always
// reported with an honesty gap. Cents per million tokens, matched by
// substring on the model id (vendor ids look like "claude-opus-4-8",
// "claude-sonnet-5", "claude-haiku-4-5-20251001", "claude-fable-5").
//
// Bump SUMMARIZER_VERSION whenever summarization semantics change — the
// server stamps source_connector as `claude-code-local@<version>` so
// restatements are traceable to summarizer behavior.

export const SUMMARIZER_VERSION = 1;

export type ModelRates = {
  /** cents per 1M input tokens */
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
};

const OPUS: ModelRates = {
  input: 1_500,
  output: 7_500,
  cacheWrite: 1_875,
  cacheRead: 150,
};
const SONNET: ModelRates = {
  input: 300,
  output: 1_500,
  cacheWrite: 375,
  cacheRead: 30,
};
const HAIKU: ModelRates = {
  input: 100,
  output: 500,
  cacheWrite: 125,
  cacheRead: 10,
};

/** Ordered — first substring match wins. Unknown models fall back to the
 * top (most expensive known) tier so estimates err high, with a gap noting
 * the unknown model. */
const RATE_TABLE: Array<{ match: string; rates: ModelRates }> = [
  { match: "opus", rates: OPUS },
  { match: "fable", rates: OPUS },
  { match: "mythos", rates: OPUS },
  { match: "sonnet", rates: SONNET },
  { match: "haiku", rates: HAIKU },
];

export const FALLBACK_RATES: ModelRates = OPUS;

export function ratesForModel(model: string): {
  rates: ModelRates;
  known: boolean;
} {
  const lower = model.toLowerCase();
  for (const { match, rates } of RATE_TABLE) {
    if (lower.includes(match)) {
      return { rates, known: true };
    }
  }
  return { rates: FALLBACK_RATES, known: false };
}

export function estimateCents(
  rates: ModelRates,
  usage: {
    input: number;
    output: number;
    cacheWrite: number;
    cacheRead: number;
  },
): number {
  return (
    (usage.input * rates.input +
      usage.output * rates.output +
      usage.cacheWrite * rates.cacheWrite +
      usage.cacheRead * rates.cacheRead) /
    1_000_000
  );
}
