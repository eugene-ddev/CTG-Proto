import { describe, expect, it } from 'vitest';
import { createBag, drawBag } from '../bag';
import { createRng } from '../rng';

const draws = (chance: number, n: number, seed = 1, size = 10) => {
  const bag = createBag(size);
  const rng = createRng(seed);
  return Array.from({ length: n }, () => drawBag(bag, chance, rng));
};

describe('марбл-бэг', () => {
  it('10%: в каждом мешке из 10 ровно одно срабатывание', () => {
    for (const seed of [1, 2, 3, 42]) {
      const r = draws(0.1, 100, seed);
      for (let k = 0; k < 10; k++) expect(r.slice(k * 10, k * 10 + 10).filter(Boolean)).toHaveLength(1);
    }
  });

  it('дробный шанс копится между мешками: 13.7% за 1000 попыток — 137±1', () => {
    for (const seed of [1, 2, 3]) {
      const n = draws(0.137, 1000, seed).filter(Boolean).length;
      expect(n).toBeGreaterThanOrEqual(136);
      expect(n).toBeLessThanOrEqual(138);
    }
  });

  it('шанс меньше 1/size: первый мешок срабатывает в среднем с этим шансом', () => {
    let hits = 0;
    for (let seed = 1; seed <= 1000; seed++) hits += draws(0.08, 10, seed).filter(Boolean).length;
    expect(hits / 1000).toBeGreaterThan(0.7);
    expect(hits / 1000).toBeLessThan(0.9);
  });

  it('0% — никогда, 100% — всегда', () => {
    expect(draws(0, 50).some(Boolean)).toBe(false);
    expect(draws(1, 50).every(Boolean)).toBe(true);
  });

  it('один seed — один порядок, разные seed-ы — разный', () => {
    expect(draws(0.3, 30, 7)).toEqual(draws(0.3, 30, 7));
    expect(draws(0.3, 30, 7)).not.toEqual(draws(0.3, 30, 8));
  });

  it('новый шанс — со следующего мешка', () => {
    const bag = createBag(10);
    const rng = createRng(5);
    const first = Array.from({ length: 10 }, () => drawBag(bag, 0.5, rng));
    const second = Array.from({ length: 10 }, () => drawBag(bag, 0.2, rng));
    expect(first.filter(Boolean)).toHaveLength(5);
    expect(second.filter(Boolean)).toHaveLength(2);
  });
});
