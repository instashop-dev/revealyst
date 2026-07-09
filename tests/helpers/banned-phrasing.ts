// Shared banned-phrasing guard (invariant b: no invented benchmark/threshold
// stated as fact). Both tests/metrics-glossary.test.ts (glossary copy,
// including the new interpretBands strings) and tests/score-insights.test.ts
// (interpretScore's rendered guidance, which now sources its text from the
// glossary) sweep against this ONE regex, so the two suites can't silently
// drift onto two different definitions of "banned" over time.
export const BANNED_PHRASING =
  /industry (average|standard|benchmark)|top.quartile|percentile|typical (teams|orgs) score/i;
