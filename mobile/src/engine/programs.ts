import type { Implement, Tier } from '../api/types';

export interface Program {
  tier: Tier;
  name: string;
  spec: string;
  body: string;
}

// Machine-first programs come first: they fit the gyms most people train in.
export const PROGRAMS: Program[] = [
  {
    tier: 'batfleck',
    name: 'Batfleck',
    spec: '~60 min · 5 treinos a cada 7 dias',
    body: 'Hipertrofia da preparação de BvS: peito, costas, pernas, ombros com trapézio e pescoço, braços. Top sets nos básicos e tiros na bike.',
  },
  {
    tier: 'gotham_armor',
    name: 'Armadura de Gotham',
    spec: '~60 min · 5 treinos a cada 7 dias',
    body: 'Proporção em V: mais volume para ombros, dorsais, peitoral superior e trapézio, pernas em manutenção, saltos e um dia de sprint e agilidade. Comece numa segunda.',
  },
  {
    tier: 'norton_fb',
    name: 'Functional Bodybuilding',
    spec: '~65 min · 4 treinos a cada 7 dias',
    body: 'Walter Norton Jr.: superior e inferior com carregamentos pesados, potência no início e um dia de agilidade e pescoço. Comece numa segunda.',
  },
  {
    tier: 'push_pull_legs',
    name: 'Push / Pull / Legs',
    spec: '~55 min · 6 treinos a cada 7 dias',
    body: 'Empurrar, puxar e pernas, duas vezes por ciclo. Volume alto, máquinas e polia primeiro.',
  },
  {
    tier: 'upper_lower',
    name: 'Upper / Lower',
    spec: '~55 min · 4 treinos a cada 7 dias',
    body: 'Superior e inferior alternados: um dia de força e um de hipertrofia para cada metade do corpo.',
  },
  {
    tier: 'full_body',
    name: 'Full Body',
    spec: '~55 min · 3 treinos a cada 7 dias',
    body: 'Corpo inteiro em três dias. Bom para começar ou para semanas corridas.',
  },
  {
    tier: 'conjugate',
    name: 'Conjugado tático',
    spec: '~55 min · 4 treinos a cada 7 dias',
    body: 'Westside adaptado: esforço máximo e esforço dinâmico. Para avançados (agachamento ≥ 1,8× e terra ≥ 2,2× o peso do corpo). Comece numa segunda.',
  },
  {
    tier: 'dark_knight',
    name: 'Dark Knight',
    spec: '60 min · 5 treinos a cada 7 dias',
    body: 'Protocolo funcional original: mobilidade obrigatória, força com carregamentos e circuito final.',
  },
  {
    tier: 'vigilante',
    name: 'Vigilante',
    spec: '45 min · 4 treinos a cada 7 dias',
    body: 'O protocolo funcional em versão curta, com metade das séries.',
  },
  {
    tier: 'brawler',
    name: 'Brawler',
    spec: '~55 min · 6 treinos a cada 8 dias',
    body: 'O mais pesado: top sets, pliometria e AMRAP. Exige termo de responsabilidade; no máximo 16 semanas seguidas.',
  },
];

export const PROGRAM_NAME = Object.fromEntries(PROGRAMS.map((p) => [p.tier, p.name])) as Record<Tier, string>;

// Bodyweight is always available, so it is not a toggle. "machine" is a legacy value the
// server expands into every station; the app lists the stations instead.
export const EQUIPMENT_GROUPS: { title: string; items: { id: Implement; label: string }[] }[] = [
  {
    title: 'Máquinas de perna',
    items: [
      { id: 'leg_press', label: 'Leg press' },
      { id: 'hack_squat', label: 'Hack' },
      { id: 'smith', label: 'Smith' },
      { id: 'leg_extension', label: 'Cadeira extensora' },
      { id: 'leg_curl', label: 'Mesa / cadeira flexora' },
      { id: 'calf_machine', label: 'Panturrilha' },
      { id: 'hip_machine', label: 'Abdutora / adutora' },
    ],
  },
  {
    title: 'Máquinas de tronco',
    items: [
      { id: 'lat_pulldown', label: 'Puxador (pulldown)' },
      { id: 'row_machine', label: 'Remada sentada / baixa' },
      { id: 'chest_press', label: 'Supino máquina' },
      { id: 'pec_deck', label: 'Voador (peck deck)' },
      { id: 'shoulder_press', label: 'Desenvolvimento máquina' },
      { id: 'cable', label: 'Polia / crossover' },
    ],
  },
  {
    title: 'Pesos livres',
    items: [
      { id: 'dumbbell', label: 'Halteres' },
      { id: 'barbell', label: 'Barra e anilhas' },
      { id: 'kettlebell', label: 'Kettlebell' },
      { id: 'trap_bar', label: 'Barra hexagonal' },
    ],
  },
  {
    title: 'Outros',
    items: [
      { id: 'ergometer', label: 'Cardio (bike, esteira, elíptico)' },
      { id: 'sled', label: 'Trenó' },
      { id: 'band', label: 'Elástico' },
      { id: 'medicine_ball', label: 'Medicine ball' },
      { id: 'roller', label: 'Rolo de liberação' },
    ],
  },
];

export const ALL_EQUIPMENT: Implement[] = EQUIPMENT_GROUPS.flatMap((g) => g.items.map((i) => i.id));

// A typical commercial gym: stations, cables, dumbbells, a barbell and cardio — no strongman kit.
export const MACHINE_GYM: Implement[] = [
  'leg_press', 'hack_squat', 'smith', 'leg_extension', 'leg_curl', 'calf_machine', 'hip_machine',
  'lat_pulldown', 'row_machine', 'chest_press', 'pec_deck', 'cable', 'dumbbell', 'barbell', 'ergometer',
];

export const GYM_PRESETS: { id: string; label: string; equipment: Implement[] | null }[] = [
  { id: 'machines', label: 'Academia de máquinas', equipment: MACHINE_GYM },
  { id: 'full', label: 'Academia completa', equipment: null },
  { id: 'home', label: 'Em casa (halteres)', equipment: ['dumbbell'] },
];
