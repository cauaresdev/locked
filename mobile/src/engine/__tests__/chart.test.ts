import { clampIndex, nearestIndex, scaleX, scaleY, seriesStats, shortDay, ticks, yDomain } from '../chart';

test('y domain pads values and includes reference lines', () => {
  const d = yDomain([80, 90], [100]);
  expect(d.min).toBeLessThan(80);
  expect(d.max).toBeGreaterThan(100);
  expect(yDomain([5, 9], [], { zero: true }).min).toBe(0);
  const flat = yDomain([70, 70]);
  expect(flat.max).toBeGreaterThan(flat.min); // a flat series still gets a usable range
  expect(yDomain([])).toEqual({ min: 0, max: 1 });
});

test('scales map the domain to pixels', () => {
  const d = { min: 0, max: 100 };
  expect(scaleY(0, d, 10, 110)).toBe(110);
  expect(scaleY(100, d, 10, 110)).toBe(10);
  expect(scaleX(0, 5, 0, 100)).toBe(0);
  expect(scaleX(4, 5, 0, 100)).toBe(100);
  expect(scaleX(0, 1, 0, 100)).toBe(50);
});

test('ticks are round numbers inside the domain', () => {
  expect(ticks({ min: 0, max: 100 })).toEqual([0, 50, 100]);
  expect(ticks({ min: 86.3, max: 91.2 })).toEqual([88, 90]);
  expect(ticks({ min: 86.3, max: 91.2 }, 5)).toEqual([87, 88, 89, 90, 91]);
  for (const t of ticks({ min: 3.2, max: 9.7 })) {
    expect(t).toBeGreaterThanOrEqual(3.2);
    expect(t).toBeLessThanOrEqual(9.7);
  }
});

test('nearest index snaps and clamps', () => {
  expect(nearestIndex(49, 3, 0, 100)).toBe(1);
  expect(nearestIndex(-20, 3, 0, 100)).toBe(0);
  expect(nearestIndex(500, 3, 0, 100)).toBe(2);
  expect(shortDay('2026-10-15')).toBe('15/10');
});

test('a held selection is dropped once the data no longer has that point', () => {
  expect(clampIndex(3, 5)).toBe(3);
  expect(clampIndex(5, 5)).toBeNull();
  expect(clampIndex(0, 0)).toBeNull();
  expect(clampIndex(null, 5)).toBeNull();
});

test('series stats skip gaps and report last, min and max', () => {
  expect(seriesStats([80, null, 78, 82, null])).toEqual({ last: 82, min: 78, max: 82 });
  expect(seriesStats([null, null])).toBeNull();
  expect(seriesStats([])).toBeNull();
});
