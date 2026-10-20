// Every acronym and technical term the app shows, with its meaning. Screens expand a term
// where it appears; this list backs the glossary in Settings.

export interface Term {
  term: string;
  meaning: string;
  detail: string;
}

export const GLOSSARY: Term[] = [
  {
    term: '1RM',
    meaning: 'Uma repetição máxima',
    detail: 'A maior carga que você levantaria uma única vez. O app estima a sua a partir das séries com repetições e esforço registrados, sem testar carga máxima.',
  },
  {
    term: 'RPE',
    meaning: 'Esforço percebido (do inglês Rate of Perceived Exertion)',
    detail: 'Nota de 6 a 10 de quão pesada foi a série, contada pelas repetições que ainda sobravam: 10 = nenhuma, 9 = uma, 8 = duas, 7 = três, 6 = quatro ou mais.',
  },
  {
    term: 'Top set',
    meaning: 'A série mais pesada do exercício',
    detail: 'Uma série única, perto do limite (esforço 8,5), feita logo depois do aquecimento. As séries de back-off vêm em seguida, com 80% da carga dela.',
  },
  {
    term: 'Back-off',
    meaning: 'Séries mais leves depois do top set',
    detail: 'Com 80% da carga do top set e mais repetições: acumulam volume sem repetir o esforço máximo.',
  },
  {
    term: 'Supersérie',
    meaning: 'Dois exercícios seguidos, sem descanso entre eles',
    detail: 'Faça uma série do primeiro, passe direto para o segundo e só então descanse. O app abre o segundo exercício sozinho.',
  },
  {
    term: 'AMRAP',
    meaning: 'Máximo de rodadas possível (do inglês As Many Rounds As Possible)',
    detail: 'O Bloco 3: um circuito repetido o máximo de vezes dentro do tempo do bloco.',
  },
  {
    term: 'Deload',
    meaning: 'Semana de descarga',
    detail: 'Um ciclo com menos séries e esforço mais baixo para o corpo absorver o treino. Programado a cada 5–6 ciclos ou após 3 dias seguidos de prontidão baixa.',
  },
  {
    term: 'VFC',
    meaning: 'Variabilidade da frequência cardíaca',
    detail: 'A variação de tempo entre um batimento e outro, medida ao acordar. Cair abaixo do seu normal por vários dias indica fadiga acumulada.',
  },
  {
    term: 'RMSSD',
    meaning: 'Raiz da média dos quadrados das diferenças entre batimentos sucessivos',
    detail: 'Método de VFC usado por cintas cardíacas e pelo Health Connect.',
  },
  {
    term: 'SDNN',
    meaning: 'Desvio padrão dos intervalos entre batimentos',
    detail: 'Método de VFC usado pelo Apple Health. Não é comparável ao RMSSD, por isso o app compara cada método só com ele mesmo.',
  },
  {
    term: 'FC',
    meaning: 'Frequência cardíaca',
    detail: 'Batimentos por minuto (bpm). FC máx. é a frequência máxima estimada pela idade (208 − 0,7 × idade) ou informada por você.',
  },
  {
    term: 'Zonas 1–5',
    meaning: 'Faixas de frequência cardíaca',
    detail: 'Percentuais da FC máx.: zona 1 a partir de 50%, zona 2 de 60%, zona 3 de 70%, zona 4 de 80%, zona 5 de 90%.',
  },
  {
    term: 'ACWR',
    meaning: 'Razão de carga aguda:crônica (do inglês Acute:Chronic Workload Ratio)',
    detail: 'Carga da última semana dividida pela média semanal do último mês, para lombar e ombros. Acima de 1,3 conta contra a prontidão.',
  },
  {
    term: 'kg·m',
    meaning: 'Quilos × metros',
    detail: 'Unidade da Capacidade de Carga Operacional: o peso carregado vezes a distância percorrida em carregamentos, trenó e barra fixa com lastro.',
  },
  {
    term: 'MET',
    meaning: 'Equivalente metabólico',
    detail: 'Múltiplo do gasto em repouso. Estima as calorias do bloco de força e de treinos sem cinta cardíaca.',
  },
  {
    term: 'kcal',
    meaning: 'Quilocalorias',
    detail: 'A unidade de energia dos alimentos e do gasto do treino.',
  },
  {
    term: 'Massa magra',
    meaning: 'Peso sem a gordura',
    detail: 'Base das metas de calorias (12–14 kcal por libra) e de proteína. Calculada pelo seu % de gordura ou, sem ele, pela altura e sexo (fórmula de Boer).',
  },
  {
    term: 'CLA',
    meaning: 'Ácido linoleico conjugado',
    detail: 'Suplemento de gordura que o protocolo Six Pack Diet prevê nas refeições.',
  },
  {
    term: 'Bluetooth LE',
    meaning: 'Bluetooth de baixo consumo',
    detail: 'O padrão sem fio usado pela cinta cardíaca e pela bike.',
  },
  {
    term: 'FTMS',
    meaning: 'Serviço de máquinas de academia (do inglês Fitness Machine Service)',
    detail: 'Padrão Bluetooth pelo qual bikes e remos enviam potência e cadência.',
  },
  {
    term: 'dBm',
    meaning: 'Intensidade do sinal Bluetooth',
    detail: 'Mais perto de zero é mais forte: acima de −60 é ótimo, abaixo de −85 é fraco.',
  },
  {
    term: 'BvS',
    meaning: 'Batman vs Superman',
    detail: 'O filme cuja preparação física inspirou o protocolo Brawler.',
  },
  {
    term: 'LGPD',
    meaning: 'Lei Geral de Proteção de Dados',
    detail: 'A lei brasileira que garante o acesso, a portabilidade e a exclusão dos seus dados. Exportar e excluir ficam em Ajustes › Conta.',
  },
];

/** Signal strength in words, for Bluetooth scan results. */
export function signalLabel(rssi: number): string {
  if (rssi >= -60) return 'sinal forte';
  if (rssi >= -75) return 'sinal médio';
  return 'sinal fraco';
}
