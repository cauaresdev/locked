/** Guided evening routine: mobility drills on a clock, then 4-7-8 breathing to wind down for sleep. */

export interface GuidedStep {
  name: string;
  seconds: number;
  cue: string;
  breathing?: boolean;
}

const BREATH = [
  { phase: 'Inspire pelo nariz', seconds: 4 },
  { phase: 'Segure', seconds: 7 },
  { phase: 'Solte pela boca', seconds: 8 },
];
const BREATH_CYCLE = BREATH.reduce((n, b) => n + b.seconds, 0); // 19 s
const BREATH_CYCLES = 4;

export const EVENING_ROUTINE: GuidedStep[] = [
  { name: 'Troca de quadril 90/90', seconds: 120, cue: 'Sentado, joelhos a 90 graus. Gire de um lado para o outro, devagar.' },
  { name: "World's Greatest Stretch", seconds: 120, cue: 'Afundo longo, cotovelo ao chão, depois gire o tronco e abra o braço. Troque de lado na metade.' },
  { name: 'Rotação torácica', seconds: 120, cue: 'Quatro apoios, mão na nuca. Gire o cotovelo para o teto. Troque de lado na metade.' },
  { name: 'Alongamento Brettzel', seconds: 120, cue: 'Deitado de lado, segure o joelho de cima e o pé de baixo. Respire fundo. Troque na metade.' },
  { name: 'Respiração 4-7-8', seconds: BREATH_CYCLE * BREATH_CYCLES, cue: 'Deitado, luz baixa. Siga o ritmo.', breathing: true },
];

export const totalSeconds = (steps: GuidedStep[]) => steps.reduce((n, s) => n + s.seconds, 0);

export interface GuidedPosition {
  index: number; // -1 once finished
  left: number; // seconds left in the step
  breath: string | null; // breathing phase, on the breathing step
  breathLeft: number;
}

export function positionAt(steps: GuidedStep[], elapsed: number): GuidedPosition {
  let t = Math.max(0, elapsed);
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (t < s.seconds) {
      let breath: string | null = null;
      let breathLeft = 0;
      if (s.breathing) {
        let c = t % BREATH_CYCLE;
        for (const b of BREATH) {
          if (c < b.seconds) {
            breath = b.phase;
            breathLeft = Math.ceil(b.seconds - c);
            break;
          }
          c -= b.seconds;
        }
      }
      return { index: i, left: Math.ceil(s.seconds - t), breath, breathLeft };
    }
    t -= s.seconds;
  }
  return { index: -1, left: 0, breath: null, breathLeft: 0 };
}
