# Knightfall · Programa completo do tier **Brawler**

> Documento gerado a partir do motor de treino do app (backend `knightfall/`), rodando o gerador de verdade.
> Não é um resumo escrito à mão: as sessões abaixo são a saída real do código em 19/10/2026.

## 1. Contexto

**Knightfall** é um app de treino (React Native + backend FastAPI) que gera a sessão do dia automaticamente. Cada sessão tem
três blocos fixos:

1. **Bloco 1 · Preparação**: cardio leve, liberação miofascial (rolo) e drills de mobilidade. É **obrigatório**: o app bloqueia o Bloco 2 até o Bloco 1 ser marcado como concluído.
2. **Bloco 2 · Força**: 5 exercícios em séries retas (carregamento, core, empurrar/puxar, dobradiça/agachamento etc.).
3. **Bloco 3 · Condicionamento**: AMRAP (máximo de rodadas no tempo) com 1 sprint na bike + 4 exercícios de "functional bodybuilding".

Existem três tiers. **Brawler** é o mais pesado, descrito no código como *"o protocolo integral documentado (6 dias de treino / 2 de folga, ~94 min)"*, com `protocol_id = bvs_heavyweight_phase_2`. Exige aceitar um termo de responsabilidade e o app recomenda no máximo **16 semanas** seguidas nele. Os tiers mais leves (Vigilante 4/7, Dark Knight 5/7) usam os mesmos modelos de dia com 50% e 75% das séries.

O código não define um "atleta-alvo" explícito além disso: o Brawler pressupõe alguém que aguenta ~94 min por dia, 6 dias seguidos.

### Premissas usadas para gerar este documento

| Parâmetro | Valor usado | Efeito |
|---|---|---|
| Equipamento | academia completa (sem restrição) | Com menos equipamento, o motor troca por variações com o que existe (ver §6.6) |
| Semente do "Chaos Engine" | `exemplo` | **Os exercícios do Bloco 2/3 variam de atleta para atleta** (cada um tem uma semente aleatória). Os padrões de movimento, séries, repetições e tempos não variam |
| Prontidão | sem dados → tratada como **verde** | Amarelo/vermelho alteram o treino (ver §6.3) |
| Histórico de cargas | nenhum | Sem histórico, o app **não sugere carga** na primeira vez: o atleta escolhe e registra carga + RPE, e as sugestões começam daí (ver §6.1) |
| Peso corporal | não informado | Só afeta a carga sugerida em exercícios com peso corporal |

### Glossário rápido

- **RPE**: esforço percebido de 1 a 10, ancorado em repetições na reserva (RPE 8 = sobravam ~2 reps; 10 = falha).
- **Tempo 4-0-4-1**: segundos de excêntrica, pausa embaixo, concêntrica e pausa em cima.
- **Modalidade**: cada exercício pode ser prescrito como *força*, *tempo* (cadência lenta), *isométrico*, *explosivo* ou *hipertrofia*. O Chaos Engine troca de modalidade/implemento a cada ciclo.
- **Ciclo**: bloco de 8 dias (6 de treino + 2 de recuperação ativa). Não é uma semana de calendário.

## 2. Estrutura do ciclo (8 dias)

| Dia | Nome | Tipo | Duração alvo | Bloco 1 | Bloco 2 | Bloco 3 |
|---|---|---|---|---|---|---|
| 1 | Puxar + Carregar | treino | 94 min | 32 min | 40 min | 22 min (AMRAP) |
| 2 | Empurrar + Antirrotação | treino | 94 min | 32 min | 40 min | 22 min (AMRAP) |
| 3 | Pernas + Dobradiça de quadril | treino | 94 min | 32 min | 40 min | 22 min (AMRAP) |
| 4 | Puxar + Pescoço | treino | 94 min | 32 min | 40 min | 22 min (AMRAP) |
| 5 | Empurrar + Ombros | treino | 94 min | 32 min | 40 min | 22 min (AMRAP) |
| 6 | Corpo inteiro ("Caos") | treino | 94 min | 32 min | 40 min | 22 min (AMRAP) |
| 7 | Recuperação ativa | folga ativa | 45 min | — | — | — |
| 8 | Recuperação ativa | folga ativa | 45 min | — | — | — |

Carga semanal aproximada: **6 × 94 min = 564 min de treino a cada 8 dias** (~8,2 h/semana-calendário), mais 2 × 45 min de recuperação ativa.

### Padrões de movimento fixos por dia

O que é fixo é o **padrão**. O exercício que ocupa cada vaga muda a cada ciclo.

| Dia | Bloco 2 (força, nesta ordem) | Bloco 3 (AMRAP, nesta ordem) |
|---|---|---|
| D1 | carregamento · flexão de tronco · puxada horizontal · pescoço · puxada vertical | sprint · puxada vertical · braços · agachamento · avanço |
| D2 | carregamento · antirrotação · empurrar horizontal · empurrar vertical · dobradiça | sprint · ombros · braços · empurrar horizontal · trapézio |
| D3 | carregamento · antirrotação · dobradiça · agachamento · avanço | sprint · dobradiça · flexão de tronco · ombros · avanço |
| D4 | carregamento · flexão de tronco · puxada vertical · puxada horizontal · pescoço | sprint · trapézio · braços · ombros · agachamento |
| D5 | carregamento · antirrotação · empurrar vertical · empurrar horizontal · puxada horizontal | sprint · ombros · braços · trapézio · puxada horizontal |
| D6 | carregamento · flexão de tronco · dobradiça · puxada vertical · empurrar horizontal | sprint · agachamento · puxada horizontal · ombros · braços |

Modalidades possíveis por vaga: carregamento = força / explosivo / isométrico; demais vagas do Bloco 2 = força / tempo /
isométrico / explosivo (pescoço só isométrico); Bloco 3 = hipertrofia / condicionamento; sprint = condicionamento (20 s) ou explosivo (15 s).

### Volume do Bloco 2 por padrão (séries por ciclo de 8 dias, semente `exemplo`)

| Padrão | Ciclo 1 | Ciclo 2 | Ciclo 3 | Ciclo 4 | Ciclo 5 (deload) |
|---|---|---|---|---|---|
| Carregamento (carries / trenó) | 23 | 24 | 23 | 25 | 14 |
| Dobradiça de quadril | 14 | 12 | 13 | 12 | 6 |
| Puxada vertical | 16 | 11 | 15 | 12 | 6 |
| Puxada horizontal | 11 | 13 | 13 | 12 | 7 |
| Empurrar horizontal | 13 | 10 | 12 | 13 | 7 |
| Empurrar vertical | 7 | 8 | 8 | 8 | 4 |
| Antirrotação | 11 | 9 | 9 | 10 | 6 |
| Flexão de tronco | 9 | 9 | 9 | 9 | 6 |
| Pescoço | 6 | 6 | 6 | 6 | 3 |
| Agachamento | 4 | 5 | 3 | 5 | 2 |
| Avanço / unilateral de pernas | 3 | 4 | 3 | 4 | 2 |
| **Total** | **117** | **111** | **114** | **116** | **63** |

O Bloco 3 soma, por ciclo, 6 vagas de sprint, 5 de braços, 5 de ombros, 3 de trapézio, 3 de agachamento, 2 de avanço,
2 de puxada horizontal e 1 de cada um destes: dobradiça, flexão de tronco, puxada vertical e empurrar horizontal. Cada vaga é feita 1 vez por rodada, quantas rodadas couberem em 22 min.

## 3. Ciclo 1 completo (dias 1–8)

No ciclo 1, o Dia 1 usa exatamente os exercícios "canônicos" do protocolo original. Os demais dias já saem do Chaos Engine.

### Dia 1 · Puxar + Carregar (94 min)

**Bloco 1 · Aquecimento, tecidos e preparação de movimento** · 32 min · checklist (sem descanso prescrito)

| # | Exercício | Implemento | Modalidade | Volume | Tempo (exc-pausa-conc-pausa) | RPE alvo | Observações |
|---|---|---|---|---|---|---|---|
| 1 | Elliptical Trainer | ergômetro | preparação | 1 × 15 min | — | — | 70% da FC máx. (frequência cardíaca máxima) |
| 2 | Rumble Roller (quadril, tensor da fáscia lata, vasto medial, glúteo, panturrilha) | rolo | preparação | 1 × 9 min | — | — | banda iliotibial (lateral da coxa); TFL (tensor da fáscia lata, lateral do quadril); VMO (vasto medial oblíquo, acima do joelho); glúteos; panturrilha |
| 3 | Plank with Arm Extension | peso corporal | preparação | 1 × isometria 2 s × 8/lado | — | — | prancha base 10 s; segurar extensão 2 s |
| 4 | Spiderman Lunge Stretch | peso corporal | preparação | 1 × 3 reps/lado | — | — | 2 respirações profundas por repetição |
| 5 | Inchworm | peso corporal | preparação | 1 × 5 reps | — | — | 1 respiração por repetição |

**Bloco 2 · Tronco, estabilidade e força bruta** · 40 min · séries retas, descanso de 60 s entre séries

| # | Exercício | Implemento | Modalidade | Volume | Tempo (exc-pausa-conc-pausa) | RPE alvo | Observações |
|---|---|---|---|---|---|---|---|
| 1 | Dumbbell Farmer's Walk | halteres | força | 4 × 60 s | — | 8 | pesado |
| 2 | Alternating Hanging Knee-Up | peso corporal | força | 3 × 11 reps/lado | — | 8 | — |
| 3 | Half-Kneeling Cable Row | polia | força | 4 × 12 reps/lado | — | 8 | — |
| 4 | Wrestler's Back Bridge | peso corporal | isométrico | 2 × isometria 15 s | — | — | pausa de 5 s dentro da série |
| 5 | Strict Pull-Up | peso corporal | tempo | 6 × 4 reps | 4-0-4-1 | 8 | — |

**Bloco 3 · Força e condicionamento (AMRAP: máximo de rodadas no tempo)** · 22 min · AMRAP: máximo de rodadas em 22 min, 30 s entre rodadas

| # | Exercício | Implemento | Modalidade | Volume | Tempo (exc-pausa-conc-pausa) | RPE alvo | Observações |
|---|---|---|---|---|---|---|---|
| 1 | Airdyne Bike Sprint | ergômetro | condicionamento | 1 × 20 s | — | — | 100% da potência máxima (watts) |
| 2 | V-Grip Lat Pulldown | polia | hipertrofia | 1 × 15 reps | — | 8 | — |
| 3 | Alternating Dumbbell Open Curl (5 esquerda, 5 direita, 5 juntos) | halteres | hipertrofia | 1 × 5+5+5 reps | — | 8 | — |
| 4 | Goblet Squat | halteres | hipertrofia | 1 × 8 reps | — | 8 | — |
| 5 | Lateral Squat | peso corporal | hipertrofia | 1 × 6 reps/lado | — | 8 | — |


### Dia 2 · Empurrar + Antirrotação (94 min)

**Bloco 1 · Aquecimento, tecidos e preparação de movimento** · 32 min · checklist (sem descanso prescrito)

| # | Exercício | Implemento | Modalidade | Volume | Tempo (exc-pausa-conc-pausa) | RPE alvo | Observações |
|---|---|---|---|---|---|---|---|
| 1 | Airdyne Bike (easy) | ergômetro | preparação | 1 × 15 min | — | — | 65–70% da FC máx. (frequência cardíaca máxima) |
| 2 | Rumble Roller (quadril, tensor da fáscia lata, vasto medial, glúteo, panturrilha) | rolo | preparação | 1 × 9 min | — | — | banda iliotibial (lateral da coxa); TFL (tensor da fáscia lata, lateral do quadril); VMO (vasto medial oblíquo, acima do joelho); glúteos; panturrilha |
| 3 | Plank with Arm Extension | peso corporal | preparação | 1 × isometria 2 s × 8/lado | — | — | prancha base 10 s; segurar extensão 2 s |
| 4 | 90/90 Hip Switch | peso corporal | preparação | 1 × 6 reps/lado | — | — | — |
| 5 | Inchworm | peso corporal | preparação | 1 × 5 reps | — | — | 1 respiração por repetição |

**Bloco 2 · Tronco, estabilidade e força bruta** · 40 min · séries retas, descanso de 60 s entre séries

| # | Exercício | Implemento | Modalidade | Volume | Tempo (exc-pausa-conc-pausa) | RPE alvo | Observações |
|---|---|---|---|---|---|---|---|
| 1 | Dumbbell Farmer's Walk | halteres | força | 4 × 60 s | — | 8 | pesado |
| 2 | Side Plank | peso corporal | isométrico | 3 × isometria 30 s × 1/lado | — | — | — |
| 3 | Dumbbell Floor Press | halteres | isométrico | 3 × isometria 15 s | — | — | pausa com braços estendidos |
| 4 | Kettlebell Bottoms-Up Press | kettlebell | isométrico | 3 × isometria 20 s | — | — | segurar acima da cabeça |
| 5 | Dumbbell Romanian Deadlift | halteres | tempo | 4 × 6 reps | 4-0-1-0 | 8 | — |

**Bloco 3 · Força e condicionamento (AMRAP: máximo de rodadas no tempo)** · 22 min · AMRAP: máximo de rodadas em 22 min, 30 s entre rodadas

| # | Exercício | Implemento | Modalidade | Volume | Tempo (exc-pausa-conc-pausa) | RPE alvo | Observações |
|---|---|---|---|---|---|---|---|
| 1 | Airdyne Bike Sprint | ergômetro | condicionamento | 1 × 20 s | — | — | 100% da potência máxima (watts) |
| 2 | Cable Lateral Raise | polia | hipertrofia | 1 × 12 reps/lado | — | 8 | — |
| 3 | Dumbbell Hammer Curl | halteres | hipertrofia | 1 × 12 reps | — | 8 | — |
| 4 | Half-Kneeling Cable Chest Press | polia | hipertrofia | 1 × 12 reps/lado | — | 8 | — |
| 5 | Dumbbell Shrug | halteres | hipertrofia | 1 × 15 reps | — | 8 | — |


### Dia 3 · Pernas + Dobradiça de quadril (94 min)

**Bloco 1 · Aquecimento, tecidos e preparação de movimento** · 32 min · checklist (sem descanso prescrito)

| # | Exercício | Implemento | Modalidade | Volume | Tempo (exc-pausa-conc-pausa) | RPE alvo | Observações |
|---|---|---|---|---|---|---|---|
| 1 | Elliptical Trainer | ergômetro | preparação | 1 × 15 min | — | — | 70% da FC máx. (frequência cardíaca máxima) |
| 2 | Rumble Roller (quadril, tensor da fáscia lata, vasto medial, glúteo, panturrilha) | rolo | preparação | 1 × 9 min | — | — | banda iliotibial (lateral da coxa); TFL (tensor da fáscia lata, lateral do quadril); VMO (vasto medial oblíquo, acima do joelho); glúteos; panturrilha |
| 3 | Inchworm | peso corporal | preparação | 1 × 5 reps | — | — | 1 respiração por repetição |
| 4 | 90/90 Hip Switch | peso corporal | preparação | 1 × 6 reps/lado | — | — | — |
| 5 | Plank with Arm Extension | peso corporal | preparação | 1 × isometria 2 s × 8/lado | — | — | prancha base 10 s; segurar extensão 2 s |

**Bloco 2 · Tronco, estabilidade e força bruta** · 40 min · séries retas, descanso de 60 s entre séries

| # | Exercício | Implemento | Modalidade | Volume | Tempo (exc-pausa-conc-pausa) | RPE alvo | Observações |
|---|---|---|---|---|---|---|---|
| 1 | Sled Push | trenó | força | 5 × 20 s | — | 8 | pesado |
| 2 | Landmine Rotation | barra | explosivo | 4 × 6 reps/lado | — | 7 | — |
| 3 | Barbell Hip Thrust | barra | força | 4 × 8 reps | — | 8 | — |
| 4 | Goblet Squat | halteres | tempo | 4 × 6 reps | 4-1-1-0 | 8 | — |
| 5 | Lateral Squat | peso corporal | força | 3 × 6 reps/lado | — | 8 | — |

**Bloco 3 · Força e condicionamento (AMRAP: máximo de rodadas no tempo)** · 22 min · AMRAP: máximo de rodadas em 22 min, 30 s entre rodadas

| # | Exercício | Implemento | Modalidade | Volume | Tempo (exc-pausa-conc-pausa) | RPE alvo | Observações |
|---|---|---|---|---|---|---|---|
| 1 | Airdyne Bike Sprint | ergômetro | condicionamento | 1 × 20 s | — | — | 100% da potência máxima (watts) |
| 2 | Kettlebell Swing | kettlebell | hipertrofia | 1 × 15 reps | — | 8 | — |
| 3 | Alternating Hanging Knee-Up | peso corporal | hipertrofia | 1 × 12 reps/lado | — | 8 | — |
| 4 | Band Pull-Apart | elástico | hipertrofia | 1 × 20 reps | — | 8 | — |
| 5 | Dumbbell Reverse Lunge | halteres | hipertrofia | 1 × 8 reps/lado | — | 8 | — |


### Dia 4 · Puxar + Pescoço (94 min)

**Bloco 1 · Aquecimento, tecidos e preparação de movimento** · 32 min · checklist (sem descanso prescrito)

| # | Exercício | Implemento | Modalidade | Volume | Tempo (exc-pausa-conc-pausa) | RPE alvo | Observações |
|---|---|---|---|---|---|---|---|
| 1 | Airdyne Bike (easy) | ergômetro | preparação | 1 × 15 min | — | — | 65–70% da FC máx. (frequência cardíaca máxima) |
| 2 | Rumble Roller (banda iliotibial, glúteo, dorsais) | rolo | preparação | 1 × 9 min | — | — | banda iliotibial (lateral da coxa); glúteos; dorsais; coluna torácica (meio das costas) |
| 3 | World's Greatest Stretch | peso corporal | preparação | 1 × 4 reps/lado | — | — | — |
| 4 | Quadruped Thoracic Spine Rotation | peso corporal | preparação | 1 × 8 reps/lado | — | — | — |
| 5 | Inchworm | peso corporal | preparação | 1 × 5 reps | — | — | 1 respiração por repetição |

**Bloco 2 · Tronco, estabilidade e força bruta** · 40 min · séries retas, descanso de 60 s entre séries

| # | Exercício | Implemento | Modalidade | Volume | Tempo (exc-pausa-conc-pausa) | RPE alvo | Observações |
|---|---|---|---|---|---|---|---|
| 1 | Kettlebell Front-Rack Carry | kettlebell | isométrico | 3 × 30 s | — | — | pausa de 5 s a cada 10 passos |
| 2 | Alternating Hanging Knee-Up | peso corporal | tempo | 3 × 8 reps/lado | 2-1-2-0 | 8 | — |
| 3 | Single-Arm Cable Pulldown | polia | força | 4 × 8 reps/lado | — | 8 | — |
| 4 | Chest-Supported Dumbbell Row | halteres | isométrico | 3 × isometria 20 s | — | — | cotovelos no topo |
| 5 | Band Neck Isometric (4-way) | elástico | isométrico | 4 × isometria 20 s | — | — | frente; trás; esquerda; direita |

**Bloco 3 · Força e condicionamento (AMRAP: máximo de rodadas no tempo)** · 22 min · AMRAP: máximo de rodadas em 22 min, 30 s entre rodadas

| # | Exercício | Implemento | Modalidade | Volume | Tempo (exc-pausa-conc-pausa) | RPE alvo | Observações |
|---|---|---|---|---|---|---|---|
| 1 | Airdyne Bike Sprint | ergômetro | condicionamento | 1 × 20 s | — | — | 100% da potência máxima (watts) |
| 2 | Dumbbell Shrug | halteres | hipertrofia | 1 × 15 reps | — | 8 | — |
| 3 | Dumbbell Skullcrusher | halteres | hipertrofia | 1 × 12 reps | — | 8 | — |
| 4 | Dumbbell Lateral Raise | halteres | hipertrofia | 1 × 15 reps | — | 8 | — |
| 5 | Goblet Squat | halteres | hipertrofia | 1 × 8 reps | — | 8 | — |


### Dia 5 · Empurrar + Ombros (94 min)

**Bloco 1 · Aquecimento, tecidos e preparação de movimento** · 32 min · checklist (sem descanso prescrito)

| # | Exercício | Implemento | Modalidade | Volume | Tempo (exc-pausa-conc-pausa) | RPE alvo | Observações |
|---|---|---|---|---|---|---|---|
| 1 | Airdyne Bike (easy) | ergômetro | preparação | 1 × 15 min | — | — | 65–70% da FC máx. (frequência cardíaca máxima) |
| 2 | Rumble Roller (banda iliotibial, glúteo, dorsais) | rolo | preparação | 1 × 9 min | — | — | banda iliotibial (lateral da coxa); glúteos; dorsais; coluna torácica (meio das costas) |
| 3 | Brettzel Stretch | peso corporal | preparação | 1 × 3 reps/lado | — | — | 2 respirações profundas por repetição |
| 4 | Plank with Arm Extension | peso corporal | preparação | 1 × isometria 2 s × 8/lado | — | — | prancha base 10 s; segurar extensão 2 s |
| 5 | Spiderman Lunge Stretch | peso corporal | preparação | 1 × 3 reps/lado | — | — | 2 respirações profundas por repetição |

**Bloco 2 · Tronco, estabilidade e força bruta** · 40 min · séries retas, descanso de 60 s entre séries

| # | Exercício | Implemento | Modalidade | Volume | Tempo (exc-pausa-conc-pausa) | RPE alvo | Observações |
|---|---|---|---|---|---|---|---|
| 1 | Suitcase Carry | kettlebell | força | 4 × 40 s | — | 8 | tempo por lado |
| 2 | Landmine Rotation | barra | explosivo | 4 × 6 reps/lado | — | 7 | — |
| 3 | Seated Dumbbell Shoulder Press | halteres | força | 4 × 8 reps | — | 8 | — |
| 4 | Dumbbell Bench Press | halteres | força | 5 × 6 reps | — | 8 | — |
| 5 | Half-Kneeling Cable Row | polia | força | 4 × 12 reps/lado | — | 8 | — |

**Bloco 3 · Força e condicionamento (AMRAP: máximo de rodadas no tempo)** · 22 min · AMRAP: máximo de rodadas em 22 min, 30 s entre rodadas

| # | Exercício | Implemento | Modalidade | Volume | Tempo (exc-pausa-conc-pausa) | RPE alvo | Observações |
|---|---|---|---|---|---|---|---|
| 1 | Airdyne Bike Sprint | ergômetro | condicionamento | 1 × 20 s | — | — | 100% da potência máxima (watts) |
| 2 | Dumbbell Lateral Raise | halteres | hipertrofia | 1 × 15 reps | — | 8 | — |
| 3 | Dumbbell Hammer Curl | halteres | hipertrofia | 1 × 12 reps | — | 8 | — |
| 4 | Trap Bar Shrug | trap bar | hipertrofia | 1 × 12 reps | — | 8 | — |
| 5 | Inverted Row | peso corporal | hipertrofia | 1 × 15 reps | — | 8 | — |


### Dia 6 · Corpo inteiro (Caos) (94 min)

**Bloco 1 · Aquecimento, tecidos e preparação de movimento** · 32 min · checklist (sem descanso prescrito)

| # | Exercício | Implemento | Modalidade | Volume | Tempo (exc-pausa-conc-pausa) | RPE alvo | Observações |
|---|---|---|---|---|---|---|---|
| 1 | Elliptical Trainer | ergômetro | preparação | 1 × 15 min | — | — | 70% da FC máx. (frequência cardíaca máxima) |
| 2 | Rumble Roller (quadril, tensor da fáscia lata, vasto medial, glúteo, panturrilha) | rolo | preparação | 1 × 9 min | — | — | banda iliotibial (lateral da coxa); TFL (tensor da fáscia lata, lateral do quadril); VMO (vasto medial oblíquo, acima do joelho); glúteos; panturrilha |
| 3 | Quadruped Thoracic Spine Rotation | peso corporal | preparação | 1 × 8 reps/lado | — | — | — |
| 4 | Inchworm | peso corporal | preparação | 1 × 5 reps | — | — | 1 respiração por repetição |
| 5 | World's Greatest Stretch | peso corporal | preparação | 1 × 4 reps/lado | — | — | — |

**Bloco 2 · Tronco, estabilidade e força bruta** · 40 min · séries retas, descanso de 60 s entre séries

| # | Exercício | Implemento | Modalidade | Volume | Tempo (exc-pausa-conc-pausa) | RPE alvo | Observações |
|---|---|---|---|---|---|---|---|
| 1 | Kettlebell Front-Rack Carry | kettlebell | isométrico | 3 × 30 s | — | — | pausa de 5 s a cada 10 passos |
| 2 | Ab Wheel Rollout | peso corporal | tempo | 3 × 6 reps | 4-0-2-0 | 8 | — |
| 3 | Kettlebell Swing | kettlebell | explosivo | 6 × 10 reps | — | 7 | — |
| 4 | Strict Pull-Up | peso corporal | tempo | 6 × 4 reps | 4-0-4-1 | 8 | — |
| 5 | Push-Up | peso corporal | explosivo | 5 × 5 reps | — | 7 | palma |

**Bloco 3 · Força e condicionamento (AMRAP: máximo de rodadas no tempo)** · 22 min · AMRAP: máximo de rodadas em 22 min, 30 s entre rodadas

| # | Exercício | Implemento | Modalidade | Volume | Tempo (exc-pausa-conc-pausa) | RPE alvo | Observações |
|---|---|---|---|---|---|---|---|
| 1 | Airdyne Bike Sprint | ergômetro | condicionamento | 1 × 20 s | — | — | 100% da potência máxima (watts) |
| 2 | Jump Squat | peso corporal | hipertrofia | 1 × 10 reps | — | 8 | — |
| 3 | Chest-Supported Dumbbell Row | halteres | hipertrofia | 1 × 12 reps | — | 8 | — |
| 4 | Dumbbell Lateral Raise | halteres | hipertrofia | 1 × 15 reps | — | 8 | — |
| 5 | Dumbbell Hammer Curl | halteres | hipertrofia | 1 × 12 reps | — | 8 | — |


### Dia 7 · Recuperação ativa (45 min)

**Bloco 1 · Recuperação ativa** · 45 min · checklist (sem descanso prescrito)

| # | Exercício | Implemento | Modalidade | Volume | Tempo (exc-pausa-conc-pausa) | RPE alvo | Observações |
|---|---|---|---|---|---|---|---|
| 1 | Easy Walk (zona 1 de frequência cardíaca) | peso corporal | condicionamento | 1 × 30 min | — | — | abaixo de 60% da FC máx. (frequência cardíaca máxima) |
| 2 | Rumble Roller (banda iliotibial, glúteo, dorsais) | rolo | preparação | 1 × 10 min | — | — | banda iliotibial (lateral da coxa); glúteos; dorsais; coluna torácica (meio das costas) |
| 3 | World's Greatest Stretch | peso corporal | preparação | 1 × 4 reps/lado | — | — | — |
| 4 | 90/90 Hip Switch | peso corporal | preparação | 1 × 6 reps/lado | — | — | — |
| 5 | Quadruped Thoracic Spine Rotation | peso corporal | preparação | 1 × 8 reps/lado | — | — | — |
| 6 | Brettzel Stretch | peso corporal | preparação | 1 × 3 reps/lado | — | — | 2 respirações profundas por repetição |


### Dia 8 · Recuperação ativa (45 min)

Idêntico ao Dia 7.

## 4. Ciclos 2 a 5: rotação de exercícios

O Bloco 1 sempre tem cardio de 15 min + rolo por 9 min + 3 drills de mobilidade, que também rotacionam. Séries, repetições e tempos
seguem o catálogo da modalidade sorteada. O ciclo 5 (dias 33–40) é o **deload programado**: as séries do Bloco 2 caem
para ~60% e o RPE alvo cai 2 pontos. Os Blocos 1 e 3 não mudam.

### Ciclo 2 (dias 9–16)

| Dia | Bloco 2 · força (séries retas) | Bloco 3 · AMRAP (1 série por rodada) | Drills de mobilidade (Bloco 1) |
|---|---|---|---|
| 1 · Puxar + Carregar | Kettlebell Front-Rack Carry — 3 × 30 s (isométrico)<br>Ab Wheel Rollout — 3 × 6 reps @ 4-0-2-0 · RPE 8 (tempo)<br>Single-Arm Dumbbell Row — 4 × 8 reps/lado · RPE 8 (força)<br>Band Neck Isometric (4-way) — 4 × isometria 20 s (isométrico)<br>V-Grip Lat Pulldown — 4 × 6 reps @ 3-0-2-1 · RPE 8 (tempo) | Airdyne Bike Sprint — 15 s<br>Neutral-Grip Pull-Up — 8 reps<br>Cable Triceps Pressdown — 15 reps<br>Kettlebell Double Front-Rack Squat — 10 reps<br>Dumbbell Reverse Lunge — 8 reps/lado | Airdyne Bike (easy) (15 min) + Rumble Roller (9 min)<br>World's Greatest Stretch<br>Brettzel Stretch<br>90/90 Hip Switch |
| 2 · Empurrar + Antirrotação | Sled Push — 5 × 20 s · RPE 8 (força)<br>Pallof Press — 3 × 10 reps/lado · RPE 8 (força)<br>Half-Kneeling Cable Chest Press — 4 × 10 reps/lado · RPE 8 (força)<br>Half-Kneeling Landmine Press — 4 × 8 reps/lado · RPE 8 (força)<br>Trap Bar Deadlift — 5 × 5 reps · RPE 8 (força) | Airdyne Bike Sprint — 15 s<br>Band Pull-Apart — 20 reps<br>Cable Triceps Pressdown — 15 reps<br>Push-Up — 20 reps<br>Trap Bar Shrug — 12 reps | Elliptical Trainer (15 min) + Rumble Roller (9 min)<br>Spiderman Lunge Stretch<br>Inchworm<br>Brettzel Stretch |
| 3 · Pernas + Dobradiça de quadril | Kettlebell Front-Rack Carry — 3 × 30 s (isométrico)<br>Side Plank — 3 × isometria 30 s × 1/lado (isométrico)<br>Dumbbell Romanian Deadlift — 4 × 6 reps @ 4-0-1-0 · RPE 8 (tempo)<br>Jump Squat — 5 × 5 reps · RPE 7 (explosivo)<br>Dumbbell Reverse Lunge — 4 × 8 reps/lado · RPE 8 (força) | Airdyne Bike Sprint — 15 s<br>Barbell Hip Thrust — 12 reps<br>Ab Wheel Rollout — 10 reps<br>Dumbbell Lateral Raise — 15 reps<br>Lateral Squat — 6 reps/lado | Airdyne Bike (easy) (15 min) + Rumble Roller (9 min)<br>Brettzel Stretch<br>World's Greatest Stretch<br>Spiderman Lunge Stretch |
| 4 · Puxar + Pescoço | Dumbbell Farmer's Walk — 4 × 60 s · RPE 8 (força)<br>Hollow Hold — 3 × isometria 30 s (isométrico)<br>Strict Pull-Up — 3 × isometria 20 s (isométrico)<br>Half-Kneeling Cable Row — 4 × 12 reps/lado · RPE 8 (força)<br>Wrestler's Back Bridge — 2 × isometria 15 s (isométrico) | Airdyne Bike Sprint — 15 s<br>Trap Bar Shrug — 12 reps<br>Cable Triceps Pressdown — 15 reps<br>Band Pull-Apart — 20 reps<br>Kettlebell Double Front-Rack Squat — 10 reps | Elliptical Trainer (15 min) + Rumble Roller (9 min)<br>Inchworm<br>Plank with Arm Extension<br>Brettzel Stretch |
| 5 · Empurrar + Ombros | Sled Push — 5 × 20 s · RPE 8 (força)<br>Pallof Press — 3 × isometria 20 s × 1/lado (isométrico)<br>Kettlebell Bottoms-Up Press — 4 × 6 reps/lado · RPE 8 (força)<br>Push-Up — 3 × isometria 30 s (isométrico)<br>Inverted Row — 5 × 5 reps · RPE 7 (explosivo) | Airdyne Bike Sprint — 15 s<br>Face Pull — 15 reps<br>Cable Triceps Pressdown — 15 reps<br>Dumbbell Shrug — 15 reps<br>Chest-Supported Dumbbell Row — 12 reps | Elliptical Trainer (15 min) + Rumble Roller (9 min)<br>Quadruped Thoracic Spine Rotation<br>90/90 Hip Switch<br>Plank with Arm Extension |
| 6 · Corpo inteiro (Caos) | Trap Bar Carry — 4 × 40 s · RPE 8 (força)<br>Alternating Hanging Knee-Up — 3 × 11 reps/lado · RPE 8 (força)<br>Barbell Hip Thrust — 3 × isometria 30 s (isométrico)<br>V-Grip Lat Pulldown — 4 × 6 reps @ 3-0-2-1 · RPE 8 (tempo)<br>Dumbbell Floor Press — 3 × isometria 15 s (isométrico) | Airdyne Bike Sprint — 15 s<br>Goblet Squat — 8 reps<br>Inverted Row — 15 reps<br>Band Pull-Apart — 20 reps<br>Cable Triceps Pressdown — 15 reps | Airdyne Bike (easy) (15 min) + Rumble Roller (9 min)<br>Inchworm<br>Spiderman Lunge Stretch<br>Plank with Arm Extension |
| 7–8 · Recuperação ativa | — | — | igual ao ciclo 1 |

### Ciclo 3 (dias 17–24)

| Dia | Bloco 2 · força (séries retas) | Bloco 3 · AMRAP (1 série por rodada) | Drills de mobilidade (Bloco 1) |
|---|---|---|---|
| 1 · Puxar + Carregar | Suitcase Carry — 4 × 40 s · RPE 8 (força)<br>Hollow Hold — 3 × isometria 30 s (isométrico)<br>Inverted Row — 4 × 8 reps @ 3-1-1-1 · RPE 8 (tempo)<br>Wrestler's Back Bridge — 2 × isometria 15 s (isométrico)<br>Strict Pull-Up — 6 × 4 reps @ 4-0-4-1 · RPE 8 (tempo) | Airdyne Bike Sprint — 20 s<br>V-Grip Lat Pulldown — 15 reps<br>Dumbbell Hammer Curl — 12 reps<br>Jump Squat — 10 reps<br>Lateral Squat — 6 reps/lado | Elliptical Trainer (15 min) + Rumble Roller (9 min)<br>Plank with Arm Extension<br>Inchworm<br>Brettzel Stretch |
| 2 · Empurrar + Antirrotação | Trap Bar Carry — 4 × 40 s · RPE 8 (força)<br>Side Plank — 3 × isometria 30 s × 1/lado (isométrico)<br>Dumbbell Floor Press — 4 × 8 reps · RPE 8 (força)<br>Seated Dumbbell Shoulder Press — 4 × 6 reps @ 3-0-2-0 · RPE 8 (tempo)<br>Single-Leg Dumbbell Romanian Deadlift — 3 × 8 reps/lado · RPE 8 (força) | Airdyne Bike Sprint — 20 s<br>Dumbbell Lateral Raise — 15 reps<br>Alternating Dumbbell Open Curl (5 esquerda, 5 direita, 5 juntos) — 5+5+5 reps<br>Dumbbell Bench Press — 12 reps<br>Dumbbell Shrug — 15 reps | Airdyne Bike (easy) (15 min) + Rumble Roller (9 min)<br>World's Greatest Stretch<br>Brettzel Stretch<br>Quadruped Thoracic Spine Rotation |
| 3 · Pernas + Dobradiça de quadril | Suitcase Carry — 4 × 40 s · RPE 8 (força)<br>Pallof Press — 3 × isometria 20 s × 1/lado (isométrico)<br>Trap Bar Deadlift — 6 × 3 reps · RPE 7 (explosivo)<br>Kettlebell Double Front-Rack Squat — 3 × isometria 20 s (isométrico)<br>Lateral Squat — 3 × 6 reps/lado · RPE 8 (força) | Airdyne Bike Sprint — 20 s<br>Kettlebell Swing — 15 reps<br>Alternating Hanging Knee-Up — 12 reps/lado<br>Band Pull-Apart — 20 reps<br>Dumbbell Reverse Lunge — 8 reps/lado | Elliptical Trainer (15 min) + Rumble Roller (9 min)<br>90/90 Hip Switch<br>Inchworm<br>World's Greatest Stretch |
| 4 · Puxar + Pescoço | Trap Bar Carry — 4 × 40 s · RPE 8 (força)<br>Ab Wheel Rollout — 3 × 6 reps @ 4-0-2-0 · RPE 8 (tempo)<br>V-Grip Lat Pulldown — 4 × 6 reps @ 3-0-2-1 · RPE 8 (tempo)<br>Inverted Row — 5 × 5 reps · RPE 7 (explosivo)<br>Band Neck Isometric (4-way) — 4 × isometria 20 s (isométrico) | Airdyne Bike Sprint — 20 s<br>Dumbbell Shrug — 15 reps<br>Dumbbell Hammer Curl — 12 reps<br>Face Pull — 15 reps<br>Jump Squat — 10 reps | Airdyne Bike (easy) (15 min) + Rumble Roller (9 min)<br>Quadruped Thoracic Spine Rotation<br>90/90 Hip Switch<br>World's Greatest Stretch |
| 5 · Empurrar + Ombros | Kettlebell Front-Rack Carry — 3 × 45 s · RPE 8 (força)<br>Landmine Rotation — 3 × 8 reps/lado · RPE 8 (força)<br>Half-Kneeling Landmine Press — 4 × 8 reps/lado · RPE 8 (força)<br>Half-Kneeling Cable Chest Press — 4 × 10 reps/lado · RPE 8 (força)<br>Chest-Supported Dumbbell Row — 4 × 8 reps · RPE 8 (força) | Airdyne Bike Sprint — 20 s<br>Band Pull-Apart — 20 reps<br>Dumbbell Skullcrusher — 12 reps<br>Trap Bar Shrug — 12 reps<br>Inverted Row — 15 reps | Airdyne Bike (easy) (15 min) + Rumble Roller (9 min)<br>Brettzel Stretch<br>World's Greatest Stretch<br>90/90 Hip Switch |
| 6 · Corpo inteiro (Caos) | Dumbbell Farmer's Walk — 4 × 60 s · RPE 8 (força)<br>Hollow Hold — 3 × isometria 30 s (isométrico)<br>Dumbbell Romanian Deadlift — 4 × 8 reps · RPE 8 (força)<br>Strict Pull-Up — 5 × 5 reps · RPE 8 (força)<br>Push-Up — 4 × 10 reps @ 3-1-1-0 · RPE 8 (tempo) | Airdyne Bike Sprint — 20 s<br>Jump Squat — 10 reps<br>Chest-Supported Dumbbell Row — 12 reps<br>Cable Lateral Raise — 12 reps/lado<br>Dumbbell Hammer Curl — 12 reps | Elliptical Trainer (15 min) + Rumble Roller (9 min)<br>90/90 Hip Switch<br>Brettzel Stretch<br>Spiderman Lunge Stretch |
| 7–8 · Recuperação ativa | — | — | igual ao ciclo 1 |

### Ciclo 4 (dias 25–32)

| Dia | Bloco 2 · força (séries retas) | Bloco 3 · AMRAP (1 série por rodada) | Drills de mobilidade (Bloco 1) |
|---|---|---|---|
| 1 · Puxar + Carregar | Trap Bar Carry — 4 × 40 s · RPE 8 (força)<br>Alternating Hanging Knee-Up — 3 × 11 reps/lado · RPE 8 (força)<br>Chest-Supported Dumbbell Row — 4 × 8 reps · RPE 8 (força)<br>Band Neck Isometric (4-way) — 4 × isometria 20 s (isométrico)<br>V-Grip Lat Pulldown — 4 × 6 reps @ 3-0-2-1 · RPE 8 (tempo) | Airdyne Bike Sprint — 15 s<br>Neutral-Grip Pull-Up — 8 reps<br>Cable Triceps Pressdown — 15 reps<br>Kettlebell Double Front-Rack Squat — 10 reps<br>Dumbbell Reverse Lunge — 8 reps/lado | Airdyne Bike (easy) (15 min) + Rumble Roller (9 min)<br>Spiderman Lunge Stretch<br>90/90 Hip Switch<br>World's Greatest Stretch |
| 2 · Empurrar + Antirrotação | Sled Push — 6 × 15 s · RPE 7 (explosivo)<br>Pallof Press — 3 × 10 reps/lado · RPE 8 (força)<br>Dumbbell Bench Press — 4 × 6 reps @ 3-0-1-0 · RPE 8 (tempo)<br>Half-Kneeling Landmine Press — 5 × 4 reps/lado · RPE 7 (explosivo)<br>Barbell Hip Thrust — 3 × isometria 30 s (isométrico) | Airdyne Bike Sprint — 15 s<br>Cable Lateral Raise — 12 reps/lado<br>Cable Triceps Pressdown — 15 reps<br>Push-Up — 20 reps<br>Trap Bar Shrug — 12 reps | Elliptical Trainer (15 min) + Rumble Roller (9 min)<br>Plank with Arm Extension<br>Quadruped Thoracic Spine Rotation<br>Inchworm |
| 3 · Pernas + Dobradiça de quadril | Trap Bar Carry — 4 × 40 s · RPE 8 (força)<br>Landmine Rotation — 4 × 6 reps/lado · RPE 7 (explosivo)<br>Single-Leg Dumbbell Romanian Deadlift — 3 × 8 reps/lado · RPE 8 (força)<br>Front Squat — 5 × 5 reps · RPE 8 (força)<br>Dumbbell Reverse Lunge — 4 × 8 reps/lado · RPE 8 (força) | Airdyne Bike Sprint — 15 s<br>Barbell Hip Thrust — 12 reps<br>Ab Wheel Rollout — 10 reps<br>Dumbbell Lateral Raise — 15 reps<br>Lateral Squat — 6 reps/lado | Airdyne Bike (easy) (15 min) + Rumble Roller (9 min)<br>Inchworm<br>90/90 Hip Switch<br>Plank with Arm Extension |
| 4 · Puxar + Pescoço | Suitcase Carry — 4 × 40 s · RPE 8 (força)<br>Alternating Hanging Knee-Up — 3 × 11 reps/lado · RPE 8 (força)<br>Neutral-Grip Pull-Up — 4 × 6 reps · RPE 8 (força)<br>Chest-Supported Dumbbell Row — 4 × 8 reps · RPE 8 (força)<br>Wrestler's Back Bridge — 2 × isometria 15 s (isométrico) | Airdyne Bike Sprint — 15 s<br>Trap Bar Shrug — 12 reps<br>Cable Triceps Pressdown — 15 reps<br>Band Pull-Apart — 20 reps<br>Goblet Squat — 8 reps | Elliptical Trainer (15 min) + Rumble Roller (9 min)<br>Inchworm<br>World's Greatest Stretch<br>Quadruped Thoracic Spine Rotation |
| 5 · Empurrar + Ombros | Trap Bar Carry — 4 × 40 s · RPE 8 (força)<br>Side Plank — 3 × isometria 30 s × 1/lado (isométrico)<br>Kettlebell Bottoms-Up Press — 3 × isometria 20 s (isométrico)<br>Dumbbell Bench Press — 5 × 6 reps · RPE 8 (força)<br>Half-Kneeling Cable Row — 4 × 8 reps/lado @ 3-1-2-0 · RPE 8 (tempo) | Airdyne Bike Sprint — 15 s<br>Dumbbell Lateral Raise — 15 reps<br>Cable Triceps Pressdown — 15 reps<br>Dumbbell Shrug — 15 reps<br>Chest-Supported Dumbbell Row — 12 reps | Elliptical Trainer (15 min) + Rumble Roller (9 min)<br>Quadruped Thoracic Spine Rotation<br>Brettzel Stretch<br>Spiderman Lunge Stretch |
| 6 · Corpo inteiro (Caos) | Kettlebell Front-Rack Carry — 3 × 30 s (isométrico)<br>Ab Wheel Rollout — 3 × 10 reps · RPE 8 (força)<br>Trap Bar Deadlift — 6 × 3 reps · RPE 7 (explosivo)<br>V-Grip Lat Pulldown — 4 × 6 reps @ 3-0-2-1 · RPE 8 (tempo)<br>Half-Kneeling Cable Chest Press — 4 × 10 reps/lado · RPE 8 (força) | Airdyne Bike Sprint — 15 s<br>Goblet Squat — 8 reps<br>Inverted Row — 15 reps<br>Band Pull-Apart — 20 reps<br>Cable Triceps Pressdown — 15 reps | Airdyne Bike (easy) (15 min) + Rumble Roller (9 min)<br>Inchworm<br>Quadruped Thoracic Spine Rotation<br>90/90 Hip Switch |
| 7–8 · Recuperação ativa | — | — | igual ao ciclo 1 |

### Ciclo 5 (dias 33–40) · DELOAD

| Dia | Bloco 2 · força (séries retas) | Bloco 3 · AMRAP (1 série por rodada) | Drills de mobilidade (Bloco 1) |
|---|---|---|---|
| 1 · Puxar + Carregar | Suitcase Carry — 2 × 40 s · RPE 6 (força)<br>Hollow Hold — 2 × isometria 30 s (isométrico)<br>Inverted Row — 2 × 8 reps @ 3-1-1-1 · RPE 6 (tempo)<br>Wrestler's Back Bridge — 1 × isometria 15 s (isométrico)<br>Single-Arm Cable Pulldown — 2 × 8 reps/lado · RPE 6 (força) | Airdyne Bike Sprint — 20 s<br>V-Grip Lat Pulldown — 15 reps<br>Dumbbell Hammer Curl — 12 reps<br>Goblet Squat — 8 reps<br>Lateral Squat — 6 reps/lado | Elliptical Trainer (15 min) + Rumble Roller (9 min)<br>Plank with Arm Extension<br>Quadruped Thoracic Spine Rotation<br>Inchworm |
| 2 · Empurrar + Antirrotação | Kettlebell Front-Rack Carry — 2 × 45 s · RPE 6 (força)<br>Landmine Rotation — 2 × 8 reps/lado · RPE 6 (força)<br>Push-Up — 2 × 10 reps @ 3-1-1-0 · RPE 6 (tempo)<br>Seated Dumbbell Shoulder Press — 2 × 6 reps @ 3-0-2-0 · RPE 6 (tempo)<br>Single-Leg Dumbbell Romanian Deadlift — 2 × 8 reps/lado · RPE 6 (força) | Airdyne Bike Sprint — 20 s<br>Dumbbell Lateral Raise — 15 reps<br>Alternating Dumbbell Open Curl (5 esquerda, 5 direita, 5 juntos) — 5+5+5 reps<br>Half-Kneeling Cable Chest Press — 12 reps/lado<br>Dumbbell Shrug — 15 reps | Airdyne Bike (easy) (15 min) + Rumble Roller (9 min)<br>World's Greatest Stretch<br>Spiderman Lunge Stretch<br>Quadruped Thoracic Spine Rotation |
| 3 · Pernas + Dobradiça de quadril | Dumbbell Farmer's Walk — 2 × 60 s · RPE 6 (força)<br>Side Plank — 2 × isometria 30 s × 1/lado (isométrico)<br>Dumbbell Romanian Deadlift — 2 × 6 reps @ 4-0-1-0 · RPE 6 (tempo)<br>Goblet Squat — 2 × 8 reps · RPE 6 (força)<br>Lateral Squat — 2 × 6 reps/lado · RPE 6 (força) | Airdyne Bike Sprint — 20 s<br>Kettlebell Swing — 15 reps<br>Alternating Hanging Knee-Up — 12 reps/lado<br>Band Pull-Apart — 20 reps<br>Dumbbell Reverse Lunge — 8 reps/lado | Elliptical Trainer (15 min) + Rumble Roller (9 min)<br>Brettzel Stretch<br>Plank with Arm Extension<br>Quadruped Thoracic Spine Rotation |
| 4 · Puxar + Pescoço | Trap Bar Carry — 2 × 40 s · RPE 6 (força)<br>Hollow Hold — 2 × isometria 30 s (isométrico)<br>Strict Pull-Up — 2 × isometria 20 s (isométrico)<br>Inverted Row — 3 × 5 reps · RPE 5 (explosivo)<br>Band Neck Isometric (4-way) — 2 × isometria 20 s (isométrico) | Airdyne Bike Sprint — 20 s<br>Dumbbell Shrug — 15 reps<br>Dumbbell Hammer Curl — 12 reps<br>Dumbbell Lateral Raise — 15 reps<br>Jump Squat — 10 reps | Airdyne Bike (easy) (15 min) + Rumble Roller (9 min)<br>World's Greatest Stretch<br>Inchworm<br>Brettzel Stretch |
| 5 · Empurrar + Ombros | Sled Push — 4 × 15 s · RPE 5 (explosivo)<br>Landmine Rotation — 2 × 6 reps/lado · RPE 5 (explosivo)<br>Half-Kneeling Landmine Press — 2 × 8 reps/lado · RPE 6 (força)<br>Push-Up — 3 × 5 reps · RPE 5 (explosivo)<br>Chest-Supported Dumbbell Row — 2 × 8 reps · RPE 6 (força) | Airdyne Bike Sprint — 20 s<br>Face Pull — 15 reps<br>Dumbbell Skullcrusher — 12 reps<br>Trap Bar Shrug — 12 reps<br>Inverted Row — 15 reps | Airdyne Bike (easy) (15 min) + Rumble Roller (9 min)<br>Plank with Arm Extension<br>90/90 Hip Switch<br>World's Greatest Stretch |
| 6 · Corpo inteiro (Caos) | Trap Bar Carry — 2 × 40 s · RPE 6 (força)<br>Alternating Hanging Knee-Up — 2 × 8 reps/lado @ 2-1-2-0 · RPE 6 (tempo)<br>Barbell Hip Thrust — 2 × isometria 30 s (isométrico)<br>Neutral-Grip Pull-Up — 2 × 6 reps · RPE 6 (força)<br>Dumbbell Bench Press — 2 × 6 reps @ 3-0-1-0 · RPE 6 (tempo) | Airdyne Bike Sprint — 20 s<br>Jump Squat — 10 reps<br>Chest-Supported Dumbbell Row — 12 reps<br>Face Pull — 15 reps<br>Dumbbell Hammer Curl — 12 reps | Elliptical Trainer (15 min) + Rumble Roller (9 min)<br>Spiderman Lunge Stretch<br>Plank with Arm Extension<br>World's Greatest Stretch |
| 7–8 · Recuperação ativa | — | — | igual ao ciclo 1 |

## 5. Recuperação ativa (dias 7 e 8)

Sempre a mesma sessão, sem rotação: caminhada leve de 30 min (abaixo de 60% da FC máx.) + rolo por 10 min (banda iliotibial,
glúteos, dorsais, torácica) + World's Greatest Stretch 4/lado, 90/90 Hip Switch 6/lado, rotação torácica em quatro apoios
8/lado e Brettzel 3/lado. Duração alvo: 45 min.

## 6. Regras do motor

### 6.1 Carga sugerida (autorregulação por RPE)

- **Caminho principal: 1RM estimado.** Usa as séries de *força* e *hipertrofia* registradas com reps + RPE ≥ 6. As de tempo,
  explosivo e isométrico ficam de fora, porque são submáximas de propósito. A série vale como `reps + (10 − RPE)` reps até a falha, e o
  e1RM sai da tabela de % da RTS (1 rep = 100%, 5 = 86,3%, 8 = 78,6%, 12 = 68%; acima de 12, uma curva de Epley ajustada).
  O e1RM atual é o melhor dos últimos 3 dias em que o exercício foi treinado, dentro de 60 dias.
- **Carga prescrita**: `e1RM × %(reps alvo, RPE alvo)`, arredondada **para baixo** no incremento do implemento:
  halteres 2 kg, kettlebell 4 kg, barra/trap bar/polia/máquina 2,5 kg, trenó 5 kg, peso corporal 2,5 kg (lastro).
- **Explosivo**: carga fixa de **65% do e1RM**, movida o mais rápido possível.
- **Peso corporal**: o peso do atleta entra na conta do sistema e só o **lastro** é prescrito.
- **Caminho reserva** (carries, trenó, séries sem reps/RPE): olha a série mais pesada do último dia.
  - RPE ≥ 2 pontos abaixo do alvo: sobe ~5% (mínimo 1 incremento).
  - 1 ponto abaixo: sobe ~2,5% (mínimo 1 incremento).
  - Mais de 0,5 acima do alvo: desce ~5%.
  - Caso contrário: mantém.
- **RPE alvo por modalidade**: força 8, tempo 8, hipertrofia 8, explosivo 7. Isométricos, cardio e sprints **não têm RPE alvo**.
- **Não existe progressão linear programada** (nem % por semana, nem ondulação). A progressão vem só da autorregulação acima e da
  troca de exercício a cada ciclo.

### 6.2 Deload

- **Programado**: a cada **5 ciclos** (o 5º, o 10º, …), ou seja, a cada 40 dias. Não acontece no 1º ciclo.
- **Por prontidão**: 3 dias **vermelhos** seguidos disparam um deload que vale por um ciclo inteiro (8 dias) a partir do dia em que a sequência fecha.
- **Efeito**: séries do Bloco 2 × 0,6 (arredondado, mínimo 1) e RPE alvo −2 (mínimo 5). Substitui o ajuste de prontidão em vez de somar com ele.
  **Bloco 1 e Bloco 3 (AMRAP) não mudam no deload.**

### 6.3 Prontidão do dia ("Batsuit Readiness")

O escore vai de 0 a 100 e mistura VFC (35%), sono (25%) e dor muscular (15%). Os pesos são renormalizados quando falta algum dado.

- **VFC**: média de 7 dias de ln(VFC) contra a linha de base de 60 dias (Plews & Buchheit). A VFC só pesa quando cai mais de 0,5 DP,
  e zera a 2 DP abaixo. Com menos de 14 leituras na base, compara o dia com a média dos 7 dias anteriores.
- **Sono**: escala linear de 4 h (0) a 8 h (1).
- **Dor**: escala de 1 (nenhuma) a 5 (muita).
- **Níveis**: verde > 69, amarelo 50–69, vermelho < 50.
- **ACWR** (carga aguda:crônica) de lombar e ombros, calculado a partir das séries registradas: só gera aviso acima de 1,3 e
  rebaixa um dia verde para amarelo acima de 1,5. Exige ≥ 21 dias de histórico.

| Nível | Bloco 1 | Bloco 2 | Bloco 3 | Duração |
|---|---|---|---|---|
| Verde | 32 min | séries normais, RPE alvo normal | normal | 94 min |
| Amarelo | 32 min | séries normais, **RPE −1** | normal | 94 min |
| Vermelho | **45 min** (rolo 9 → 17 min, +2 drills) | **−1 série** por exercício, **RPE −1** | normal | **107 min** |

### 6.4 Descanso

- Bloco 2: **60 s** entre séries, para qualquer exercício: de um 5×5 de levantamento terra na trap bar a uma ponte de pescoço de 15 s. Existe um teto global de 60 s.
  O app inicia o descanso automaticamente após cada série registrada.
- Bloco 3: **30 s** entre rodadas do AMRAP. O app cronometra esse descanso ao tocar em "+1 rodada", enquanto o relógio de 22 min do bloco continua correndo.
- Exercícios unilaterais (por lado): o descanso de 60 s conta depois dos dois lados.

### 6.5 AMRAP (Bloco 3)

- 22 min, máximo de rodadas. Cada rodada é: sprint na Airdyne (20 s a 100% da potência no modo condicionamento; 15 s no modo explosivo)
  + 4 exercícios × 1 série nas reps do catálogo (8 a 20 reps, RPE alvo 8).
- O app registra a rodada usando como carga a última carga do exercício (ou a sugerida). Não registra RPE nem reps reais por rodada.

### 6.6 Chaos Engine (rotação de exercícios)

- Os padrões de cada dia são fixos. A cada ciclo, cada vaga recebe um exercício **diferente do ciclo anterior** e, se o catálogo permitir,
  com outro **implemento ou modalidade** (ex.: halteres → polia, isométrico → explosivo), para "evitar acomodação neural e lesão por repetição".
- O sorteio é determinístico por (semente do atleta, dia, ciclo, equipamento). Dentro de um mesmo dia não se repete exercício,
  mas o mesmo exercício pode aparecer em vários dias do mesmo ciclo (ex.: trap bar carry nos dias 1, 3 e 5 do ciclo 4).
- Com pouco equipamento: o peso corporal está sempre disponível. Variações só com peso corporal ("stand-ins": flexão pike,
  agachamento livre, hip thrust unilateral, bear crawl, mountain climber sprint, etc.) só entram quando o padrão ficaria sem opção.
  Quando nem isso existe, o exercício entra mesmo assim e o app avisa qual equipamento falta.
- **Troca manual**: em qualquer exercício do Bloco 2 ainda sem série registrada, e nos exercícios do Bloco 3 (menos o sprint)
  antes de o AMRAP começar, o atleta pode trocar por até 8 alternativas do mesmo padrão, com o equipamento que tem, prescritas
  com os mesmos parâmetros do bloco.
- **Sem repetição no dia**: um mesmo movimento nunca aparece duas vezes na sessão (por exemplo, como drill no Bloco 1 e como
  exercício no Bloco 2), a não ser que o equipamento disponível não deixe outra opção.

### 6.7 Duração máxima no tier

A partir de 16 semanas no Brawler, toda sessão mostra um aviso sugerindo descer de tier. O app não força a troca.

### 6.8 Catálogo de exercícios por padrão (para referência)

| Padrão | Exercícios possíveis |
|---|---|
| Carregamento | Farmer's Walk (halteres), Trap Bar Carry, Suitcase Carry (KB), KB Front-Rack Carry, Sled Push, Bear Crawl* |
| Flexão de tronco | 9 | 9 | 9 | 9 | 6 |
| Antirrotação | 11 | 9 | 9 | 10 | 6 |
| Puxada vertical | 16 | 11 | 15 | 12 | 6 |
| Puxada horizontal | 11 | 13 | 13 | 12 | 7 |
| Empurrar horizontal | 13 | 10 | 12 | 13 | 7 |
| Empurrar vertical | 7 | 8 | 8 | 8 | 4 |
| Agachamento | 4 | 5 | 3 | 5 | 2 |
| Dobradiça | Trap Bar Deadlift, DB Romanian Deadlift, KB Swing, Single-Leg RDL, Barbell Hip Thrust, Single-Leg Hip Thrust*, Broad Jump* |
| Avanço | Lateral Squat, DB Reverse Lunge, Rear-Foot-Elevated Split Squat, Jumping Lunge* |
| Pescoço | 6 | 6 | 6 | 6 | 3 |
| Braços (AMRAP) | Open Curl complex, Hammer Curl, Triceps Pressdown, DB Skullcrusher, Diamond Push-Up* |
| Ombros (AMRAP) | DB Lateral Raise, Cable Lateral Raise, Face Pull, Band Pull-Apart, Prone Y-T-W* |
| Trapézio (AMRAP) | DB Shrug, Trap Bar Shrug, Scapular Pull-Up* |
| Sprint | Airdyne Sprint, Mountain Climber Sprint* |

\* stand-in: só entra quando falta equipamento.

## 7. Pontos que eu (autor do app) já acho questionáveis

Para o avaliador considerar, sem tomar como verdade:

1. **Pernas com pouco volume de força**: só 3–5 séries de agachamento e 3–4 de avanço por ciclo no Bloco 2, contra 23 de carregamento e ~14 de dobradiça.
2. **Carregamento todos os 6 dias**, e a dobradiça aparece em 3 dos 6 dias de força (D2, D3, D6), mais o KB swing no AMRAP do D3. Isso pesa na lombar.
3. **Descanso fixo de 60 s** inclusive em 5×5 pesados (trap bar deadlift, front squat) a RPE 8.
4. **O deload e a prontidão vermelha não tocam no AMRAP**: 22 min de sprints a 100% continuam iguais. Num dia vermelho a sessão fica **mais longa** (107 min).
5. **A rotação pode gerar dias incoerentes com o nome**: ex.: ciclo 1, D2 "Empurrar" teve os dois empurrões em isometria (floor press e bottoms-up press segurados), sem nenhum empurrão dinâmico.
6. **Lateral Squat com peso corporal** prescrito com RPE 8 no bloco de força: sem carga, dificilmente chega a RPE 8 com 6 reps/lado.
7. **Não há progressão planejada** entre ciclos além da autorregulação por RPE e da troca de exercícios. Como o exercício muda a cada ciclo, uma mesma carga raramente se repete em ciclos seguidos.

## 8. Perguntas para o avaliador

1. Para um atleta intermediário/avançado, **6 dias de ~94 min seguidos de 2 dias de folga ativa** é sustentável por até 16 semanas? O que você mudaria na distribuição (6/2 contra 3/1/2/1, por exemplo)?
2. O **volume semanal por padrão** (tabela da §2) está equilibrado? Em especial: pernas (agachamento/avanço) contra carregamento e dobradiça, e empurrar vertical contra horizontal.
3. **Descanso de 60 s** entre séries pesadas de força (5×5 a RPE 8) é adequado para o objetivo de "força bruta"? Faria sentido escalar o descanso pela modalidade (força 2–3 min, hipertrofia 60–90 s, isometria 30–45 s)?
4. A rotação de exercício/modalidade **a cada 8 dias** ajuda ou atrapalha a progressão de força, considerando que a carga é autorregulada pelo RPE e o exercício muda todo ciclo? Seria melhor fixar os principais por 3–4 ciclos?
5. O **deload** (a cada 40 dias, −40% das séries e −2 de RPE só no Bloco 2) está bem dimensionado? O AMRAP e os sprints também deveriam ser reduzidos?
6. Os ajustes por **prontidão** (amarelo: −1 RPE; vermelho: −1 série, −1 RPE e +13 min de mobilidade) são proporcionais? Num dia vermelho, a sessão deveria ficar mais curta em vez de mais longa?
7. O **Bloco 1 de 32 min** (15 min de cardio + 9 de rolo + 3 drills) é longo demais para um aquecimento diário? Que parte poderia virar trabalho útil?
8. Há **riscos de lesão** óbvios na combinação: carga lombar acumulada (carries diários + dobradiça 3×), ponte de pescoço (wrestler's bridge) e sprints máximos todo dia de treino?
