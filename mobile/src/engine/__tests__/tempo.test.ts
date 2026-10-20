import { buildTimeline, cues, metronomeView, sameView, stateAt, totalMs } from '../tempo';

const PULL_UP = { eccentric: 4, bottom_pause: 0, concentric: 4, top_pause: 1 };

describe('cadence timeline', () => {
  it('skips zero-length phases and starts pulls with the concentric', () => {
    const t = buildTimeline(PULL_UP, 4, 'pull_vertical');
    expect(t.slice(0, 3).map((s) => s.phase)).toEqual(['concentric', 'top_pause', 'eccentric']);
    expect(t).toHaveLength(12);
    expect(totalMs(t)).toBe(4 * 9 * 1000);
  });

  it('starts presses with the eccentric', () => {
    const t = buildTimeline({ eccentric: 3, bottom_pause: 0, concentric: 1, top_pause: 0 }, 2, 'push_horizontal');
    expect(t.map((s) => s.phase)).toEqual(['eccentric', 'concentric', 'eccentric', 'concentric']);
  });

  it('reports rep, phase and second within phase', () => {
    const t = buildTimeline(PULL_UP, 4, 'pull_vertical');
    expect(stateAt(t, 0)).toMatchObject({ rep: 1, phase: 'concentric', secondInPhase: 1, phaseSeconds: 4 });
    expect(stateAt(t, 3999)).toMatchObject({ rep: 1, phase: 'concentric', secondInPhase: 4 });
    expect(stateAt(t, 4000)).toMatchObject({ rep: 1, phase: 'top_pause', secondInPhase: 1 });
    expect(stateAt(t, 9000)).toMatchObject({ rep: 2, phase: 'concentric' });
    expect(stateAt(t, 36000).done).toBe(true);
  });

  it('emits one cue per second: phase on boundaries, tick otherwise, then done', () => {
    const t = buildTimeline(PULL_UP, 1, 'pull_vertical');
    const c = cues(t);
    expect(c.map((x) => x.kind)).toEqual([
      'phase', 'tick', 'tick', 'tick', // concentric 4s
      'phase', // top pause 1s
      'phase', 'tick', 'tick', 'tick', // eccentric 4s
      'done',
    ]);
    expect(c.map((x) => x.atMs)).toEqual([0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000]);
  });
});

describe('metronome view', () => {
  const t = buildTimeline(PULL_UP, 2, 'pull_vertical');

  it('counts the lead-in down, then follows the timeline', () => {
    expect(metronomeView(t, -3000).leadIn).toBe(3);
    expect(metronomeView(t, -2001).leadIn).toBe(3);
    expect(metronomeView(t, -1).leadIn).toBe(1);
    expect(metronomeView(t, -1)).toMatchObject({ rep: 1, phase: 'concentric', secondInPhase: 1 });
    expect(metronomeView(t, 4500)).toMatchObject({ leadIn: 0, rep: 1, phase: 'top_pause', secondInPhase: 1 });
  });

  it('changes only on whole-second or phase boundaries', () => {
    expect(sameView(metronomeView(t, 1000), metronomeView(t, 1950))).toBe(true);
    expect(sameView(metronomeView(t, 1950), metronomeView(t, 2000))).toBe(false);
    expect(sameView(metronomeView(t, -2500), metronomeView(t, -2050))).toBe(true);
    expect(sameView(metronomeView(t, -2050), metronomeView(t, -1950))).toBe(false);
  });
});
