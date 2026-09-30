/**
 * Small seeded PRNG (mulberry32). Deterministic data matters here: the same seed must
 * produce the same sessions on the server and in tests, or snapshots and hydration
 * assertions become flaky.
 */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(probability: number): boolean;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => {
      if (items.length === 0) throw new Error("pick() from empty list");
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    chance: (probability) => next() < probability,
  };
}
