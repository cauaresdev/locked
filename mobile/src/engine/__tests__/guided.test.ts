import { EVENING_ROUTINE, positionAt, totalSeconds } from '../guided';

test('the evening routine is about ten minutes', () => {
  expect(totalSeconds(EVENING_ROUTINE)).toBe(4 * 120 + 4 * 19);
});

test('position walks the steps and the breathing phases', () => {
  expect(positionAt(EVENING_ROUTINE, 0)).toMatchObject({ index: 0, left: 120, breath: null });
  expect(positionAt(EVENING_ROUTINE, 130)).toMatchObject({ index: 1, left: 110 });
  const breathing = 4 * 120;
  expect(positionAt(EVENING_ROUTINE, breathing + 1)).toMatchObject({ index: 4, breath: 'Inspire pelo nariz', breathLeft: 3 });
  expect(positionAt(EVENING_ROUTINE, breathing + 5)).toMatchObject({ breath: 'Segure', breathLeft: 6 });
  expect(positionAt(EVENING_ROUTINE, breathing + 12)).toMatchObject({ breath: 'Solte pela boca', breathLeft: 7 });
  expect(positionAt(EVENING_ROUTINE, breathing + 19)).toMatchObject({ breath: 'Inspire pelo nariz' });
  expect(positionAt(EVENING_ROUTINE, 10_000).index).toBe(-1);
});
