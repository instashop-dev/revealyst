// Deterministic PRNG + small helpers for the demo-seed generator. PURE: no
// Date.now, no global mutable state — every caller threads an explicit Rng
// through, so the same seed + same call sequence always yields the same
// values (byte-identical SeedPlan for a given anchorDay, per README.md).

/** Fixed default seed — same seed + same anchorDay ⇒ identical plan. */
export const DEFAULT_SEED = 0x5eed_1234;

export type Rng = () => number;

/**
 * mulberry32: small-state, fast, decent-quality deterministic PRNG.
 * Returns a float in [0, 1).
 */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Inclusive integer in [min, max]. */
export function randInt(rng: Rng, min: number, max: number): number {
  if (max < min) throw new Error(`randInt: max ${max} < min ${min}`);
  return Math.floor(rng() * (max - min + 1)) + min;
}

/** Float in [min, max). */
export function randFloat(rng: Rng, min: number, max: number): number {
  return rng() * (max - min) + min;
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error("pick: empty array");
  return items[randInt(rng, 0, items.length - 1)];
}

/** True with probability `probability` (0..1). */
export function chance(rng: Rng, probability: number): boolean {
  return rng() < probability;
}

/** Jitter a base value by +/- `fraction` (e.g. 0.15 = +/-15%), floored at 0. */
export function jitter(rng: Rng, base: number, fraction: number): number {
  const delta = base * fraction;
  return Math.max(0, base + randFloat(rng, -delta, delta));
}

/** Jitter + round to an integer, floored at `min` (default 0). */
export function jitterInt(
  rng: Rng,
  base: number,
  fraction: number,
  min = 0,
): number {
  return Math.max(min, Math.round(jitter(rng, base, fraction)));
}

/** Fisher-Yates shuffle over a copy — never mutates the input. */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(rng, 0, i);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/** Linear interpolation, `t` clamped to [0, 1]. */
export function lerp(from: number, to: number, t: number): number {
  const clamped = Math.min(Math.max(t, 0), 1);
  return from + (to - from) * clamped;
}
