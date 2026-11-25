import { describe, expect, it } from 'vitest';
import { createRng } from './rng';

describe('createRng / Rng.pick', () => {
  it('throws when called with an empty array', () => {
    const rng = createRng(42);
    expect(() => rng.pick([])).toThrow('Rng.pick called with empty array');
  });

  it('returns undefined when picking from [undefined]', () => {
    const rng = createRng(42);
    expect(rng.pick([undefined])).toBeUndefined();
  });

  it('picks an element deterministically from a non-empty array', () => {
    const items = ['alpha', 'beta', 'gamma'] as const;
    const rngA = createRng(12345);
    const rngB = createRng(12345);

    const pickedA = Array.from({ length: 10 }, () => rngA.pick(items));
    const pickedB = Array.from({ length: 10 }, () => rngB.pick(items));

    expect(pickedA).toEqual(pickedB);
    for (const v of pickedA) {
      expect(items).toContain(v);
    }
  });
});
