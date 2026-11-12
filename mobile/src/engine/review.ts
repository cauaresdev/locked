import type { Progress } from '../api/types';
import { addDays } from './format';

/**
 * Weekly review: the last 7 days of the progress report boiled down to a few numbers and at most three
 * actions, most important first. Pure, so it works on the report saved offline too.
 */

export type Goal = 'cut' | 'maintain' | 'bulk' | 'cycle';

export interface ReviewStat {
  label: string;
  value: string;
  ok: boolean | null; // null: nothing to judge
}

export interface WeeklyReview {
  from: string;
  to: string;
  stats: ReviewStat[];
  actions: string[];
}

export interface ReviewContext {
  today: string;
  sleepTargetHours: number;
  goal: Goal;
  bedtime?: string | null;
}

const MAX_ACTIONS = 3;
const ATTENDANCE_OK = 0.75;
const SLEEP_SLACK_H = 0.5;
const PROTEIN_OK = 0.9;
const KCAL_BAND = 0.1;
const DEFAULT_BAND = [10, 20];
// Muscles every program is expected to train; others are judged only when the program sets its own band.
const MAJOR = new Set(['chest', 'back', 'shoulders', 'quads', 'hamstrings', 'glutes']);
const LIFT_CHANGE = 0.02; // e1RM moves under 2 % are noise

const fmt = (n: number, digits = 1) => n.toFixed(digits).replace('.', ',');
const signed = (n: number, digits = 1) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n), digits)}`;
const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}` : xs[0] ?? '');

/** Expected weekly weight change for the goal, as a share of body weight (low, high). */
function weightBand(goal: Goal): [number, number] {
  if (goal === 'cut') return [-0.01, -0.0025];
  if (goal === 'bulk') return [0.001, 0.005];
  return [-0.003, 0.003];
}

export function weeklyReview(p: Progress, ctx: ReviewContext): WeeklyReview {
  const from = addDays(ctx.today, -6);
  const inWeek = (d: string) => d >= from && d <= ctx.today;
  const stats: ReviewStat[] = [];
  const actions: { weight: number; text: string }[] = [];

  // Training attendance.
  const planned = p.attendance.filter((d) => inWeek(d.day) && d.planned);
  const done = planned.filter((d) => d.trained).length;
  if (planned.length) {
    const share = done / planned.length;
    stats.push({ label: 'Treinos', value: `${done} de ${planned.length}`, ok: share >= ATTENDANCE_OK });
    if (share < ATTENDANCE_OK) {
      actions.push({ weight: 10, text: `Você fez ${done} de ${planned.length} treinos. Em dia corrido, escolha "Tempo ` +
        'disponível" em Hoje para encurtar a sessão em vez de pular; se a semana inteira aperta, um programa com ' +
        'menos dias (Full Body 3×) rende mais.' });
    }
  }

  // Sleep.
  const nights = p.readiness.filter((r) => inWeek(r.day) && r.sleep_hours != null).map((r) => r.sleep_hours as number);
  if (nights.length) {
    const avg = nights.reduce((a, b) => a + b, 0) / nights.length;
    const ok = avg >= ctx.sleepTargetHours - SLEEP_SLACK_H;
    stats.push({ label: 'Sono médio', value: `${fmt(avg)} h`, ok });
    if (!ok) {
      actions.push({ weight: 9, text: `Sono médio de ${fmt(avg)} h, abaixo da meta de ${fmt(ctx.sleepTargetHours)} h. ` +
        `${ctx.bedtime ? `Deite às ${ctx.bedtime} e ative` : 'Ative'} os lembretes de telas e cama na aba Rotina: ` +
        'é o que mais pesa na prontidão e na recuperação.' });
    }
  }

  // Strength: latest estimate this week vs the latest before it.
  const ups: string[] = [];
  const downs: string[] = [];
  for (const lift of p.strength) {
    const now = lift.history.filter(([d]) => inWeek(d)).at(-1);
    const before = lift.history.filter(([d]) => d < from).at(-1);
    if (!now || !before) continue;
    const change = now[1] / before[1] - 1;
    if (change >= LIFT_CHANGE) ups.push(lift.name);
    else if (change <= -LIFT_CHANGE) downs.push(lift.name);
  }
  if (ups.length || downs.length) {
    stats.push({ label: 'Força', value: `${ups.length} subiram · ${downs.length} caíram`, ok: downs.length <= ups.length });
  }
  if (downs.length >= 2) {
    actions.push({ weight: 8, text: `${list(downs)} caíram na semana. Mais de um básico caindo junto é fadiga: ` +
      'priorize sono e calorias, e se continuar na próxima semana, antecipe o deload.' });
  }

  // Weekly sets per muscle against the program's band.
  const low = p.muscle_volume.filter((m) => {
    const custom = m.target_min !== DEFAULT_BAND[0] || m.target_max !== DEFAULT_BAND[1];
    return (MAJOR.has(m.muscle) || custom) && m.target_min > 0 && m.sets < m.target_min;
  });
  const high = p.muscle_volume.filter((m) => m.target_max > 0 && m.sets > m.target_max * 1.25);
  const covered = p.muscle_volume.filter((m) => MAJOR.has(m.muscle));
  if (covered.length) {
    stats.push({ label: 'Músculos na faixa', value: `${covered.filter((m) => m.sets >= m.target_min).length} de ${covered.length}`,
      ok: low.length === 0 });
  }
  if (low.length && planned.length && done / planned.length >= ATTENDANCE_OK) {
    // Only when the athlete trained: a missed week shows up as attendance, not as a volume problem.
    actions.push({ weight: 6, text: `${list(low.map((m) => `${m.label.toLowerCase()} (${m.sets} de ${m.target_min})`))} ` +
      'ficaram abaixo das séries semanais. Não pule os acessórios desses músculos; se o tempo é o limite, use ' +
      'a supersérie do modo "Tempo disponível".' });
  }
  if (high.length) {
    actions.push({ weight: 3, text: `${list(high.map((m) => m.label.toLowerCase()))} passaram bem do volume alvo. ` +
      'Mais séries não é mais músculo: segure o volume e foque na carga.' });
  }

  // Body weight trend against the goal.
  const trendAt = (day: string) => p.weight.entries.filter((e) => e.day <= day).at(-1)?.trend_kg ?? null;
  const end = trendAt(ctx.today);
  const start = trendAt(addDays(ctx.today, -7));
  if (end != null && start != null && start !== end) {
    const delta = end - start;
    const [lo, hi] = weightBand(ctx.goal).map((x) => x * start);
    const ok = ctx.goal === 'cycle' ? null : delta >= lo && delta <= hi;
    stats.push({ label: 'Peso (média 7 dias)', value: `${signed(delta)} kg`, ok });
    if (ok === false) {
      const text = ctx.goal === 'cut'
        ? (delta > hi
          ? 'O peso não desceu no cut. Confira se as calorias registradas batem a meta (a balança da cozinha ajuda) e mantenha os passos.'
          : 'O peso caiu rápido demais para um cut (acima de 1% por semana): suba um pouco as calorias para preservar massa muscular.')
        : ctx.goal === 'bulk'
          ? (delta < lo
            ? 'O peso não subiu no bulk: acrescente cerca de 200 kcal por dia.'
            : 'O peso subiu rápido demais no bulk: corte cerca de 200 kcal para ganhar menos gordura.')
          : `O peso mudou ${signed(delta)} kg na manutenção: ajuste as calorias em ~150 kcal no sentido contrário.`;
      actions.push({ weight: 7, text });
    }
  }

  // Diet: calories on target, and protein.
  const diet = p.diet.filter((d) => inWeek(d.day) && d.kcal_target > 0);
  if (diet.length) {
    const onKcal = diet.filter((d) => Math.abs(d.kcal / d.kcal_target - 1) <= KCAL_BAND).length;
    const lowProtein = diet.filter((d) => d.protein_target_g > 0 && d.protein_g < d.protein_target_g * PROTEIN_OK);
    stats.push({ label: 'Dieta na meta', value: `${onKcal} de ${diet.length} dias`, ok: onKcal >= diet.length * 0.7 });
    if (lowProtein.length >= 3) {
      actions.push({ weight: 5, text: `Proteína abaixo da meta em ${lowProtein.length} dias. Uma porção de 30–40 g ` +
        'logo depois do treino e outra antes de dormir fecham a conta.' });
    }
  }

  const ordered = actions.sort((a, b) => b.weight - a.weight).slice(0, MAX_ACTIONS).map((a) => a.text);
  if (ordered.length === 0 && stats.length) {
    ordered.push('Semana sólida: mantenha o plano. A carga sobe sozinha conforme o esforço que você registra.');
  }
  return { from, to: ctx.today, stats, actions: ordered };
}
