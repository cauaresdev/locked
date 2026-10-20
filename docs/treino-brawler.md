# Knightfall · Programa Brawler V2

> Gerado a partir do motor de treino do app (`backend/knightfall/brawler_v2.py`): as tabelas abaixo são a saída
> real do código, não um resumo escrito à mão. Substitui o programa Brawler anterior (6 dias de treino + 2 de folga).

## 1. Contexto

**Knightfall** é um app de treino que gera a sessão do dia. O tier **Brawler** é o mais pesado. Ele exige aceitar um
termo de responsabilidade, e o app recomenda no máximo **16 semanas** seguidas nele. Vigilante e Dark Knight continuam
no programa antigo.

**Premissas usadas para gerar este documento:** academia completa, prontidão verde, sem histórico de cargas e semente
de sorteio `exemplo`. Sem histórico o app não sugere carga: o atleta registra carga e esforço (RPE), e as sugestões
partem daí.

## 2. Regras do motor

- **Ciclo de 8 dias:** 3 dias de treino, 1 de recuperação ativa, 3 de treino e 1 de descanso absoluto.
- **Três blocos por dia de treino:**
  - **Bloco 1 · Preparação (8–10 min):** mobilidade e potência (pliometria e arremessos). É obrigatório: o Bloco 2 só
    libera depois dele.
  - **Bloco 2 · Força e estrutura (35–40 min):** séries retas.
  - **Bloco 3 · AMRAP (10–12 min):** máximo de rodadas no tempo, sem descanso prescrito entre as rodadas.
- **Descanso por exercício:**
  - 3 a 4 min nos top sets e nas séries pesadas de força (o app usa 3 min ou 3,5 min);
  - 2 min nas demais séries de força;
  - 90 s em hipertrofia;
  - 60 s em isometria e pliometria;
  - na supersérie, nada entre os dois exercícios e o descanso só depois do segundo.
- **Top set + back-off:** uma série pesada a esforço 8,5 e depois as séries de back-off com 80% da carga do top set, a
  esforço 7,5.
- **Fixação de padrões:**
  - os levantamentos primários (supino, agachamento, remada, desenvolvimento, stiff, barra fixa, leg press e hip
    thrust) não mudam;
  - os acessórios e os exercícios do AMRAP trocam a cada ciclo, dentro do mesmo padrão de movimento;
  - o pescoço é sempre o neck curl com anilha (a wrestler's bridge saiu do programa).
- **Cargas:**
  - vêm do 1RM estimado pelas séries registradas (autorregulação por RPE);
  - no agachamento, a sugestão é a carga do último top set mais 2 kg a cada ciclo;
  - a faixa de repetições (ex.: 8–10) é carregada pelo número de cima.
- **Prontidão:**
  - amarelo: esforço alvo do Bloco 2 −1;
  - vermelho: o AMRAP é cancelado e as séries do Bloco 2 caem pela metade (a sessão fica com cerca de metade do tempo).
- **Deload** (a cada 5 ciclos, cerca de 6 semanas, ou depois de 3 dias seguidos de prontidão baixa):
  - séries do Bloco 2 ×0,6 e esforço alvo −2;
  - AMRAP de 10 min com cargas 50% mais leves.
- **Recuperação ativa (dia 4):** 30 min de caminhada na zona 1 (FC < 60%), 10 min de rolo e 4 alongamentos.
- **Descanso absoluto (dia 8):** sem sessão.

## 3. Ciclo 1 completo

### Dia 1 · Tração bruta + carregamento (53 min)

**Bloco 1 · Preparação: mobilidade e potência** · 8 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Quadruped Thoracic Spine Rotation | 1 × 2 min | — | — | — | — |
| Medicine Ball Slam | 3 × 5 reps | — | — | 1 min | arremesso contra o solo |

**Bloco 2 · Força e estrutura** · 35 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Barbell Bent-Over Row | 1 × 5 reps | — | 8,5 | 3 min | top set |
| Barbell Bent-Over Row | 3 × 8 reps | — | 7,5 | 3 min | back-off |
| Wide-Grip Lat Pulldown | 3 × 8–10 reps | — | 8 | 2 min | pela frente |
| Dumbbell Farmer's Walk | 3 × 40 m | — | 8 | 2 min | pesado |

**Bloco 3 · AMRAP: máximo de rodadas no tempo** · 10 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Kettlebell Swing | 1 × 10 reps | — | 8 | — | — |
| Inverted Row | 1 × 8 reps | — | 8 | — | no TRX ou na barra baixa |
| Push-Up | 1 × 10 reps | — | 8 | — | — |

### Dia 2 · Empurrar + largura de ombros (55 min)

**Bloco 1 · Preparação: mobilidade e potência** · 8 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Band Shoulder Mobility | 1 × 3 min | — | — | — | deslocamentos com elástico; rotações externas |
| Box Jump | 3 × 4 reps | — | — | 1 min | aterrissagem suave; desça caminhando |

**Bloco 2 · Força e estrutura** · 35 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Barbell Bench Press | 1 × 5 reps | — | 8,5 | 3,5 min | top set |
| Barbell Bench Press | 3 × 8 reps | — | 7,5 | 3,5 min | back-off |
| Seated Dumbbell Shoulder Press | 3 × 8–10 reps | — | 8 | 2 min | pegada semi-neutra |
| Dumbbell Lateral Raise | 4 × 12 reps | — | 8 | 90 s | — |

**Bloco 3 · AMRAP: máximo de rodadas no tempo** · 12 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Airdyne Bike Sprint | 1 × 15 s | — | — | — | 100% da potência máxima (watts) |
| Wall Ball | 1 × 12 reps | — | 8 | — | — |
| V-Up | 1 × 15 reps | — | 8 | — | — |

### Dia 3 · Base de força + correção de core (60 min)

**Bloco 1 · Preparação: mobilidade e potência** · 10 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| 90/90 Hip Switch | 1 × 4 min | — | — | — | mobilidade de quadril profunda |
| Short Sprint | 5 × 20 m | — | — | 90 s | velocidade máxima |

**Bloco 2 · Força e estrutura** · 40 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Low-Bar Back Squat | 4 × 5–8 reps | — | 8 | 3,5 min | — |
| Barbell Romanian Deadlift (stiff) | 3 × 8–10 reps | 3-0-1-0 | 8 | 2 min | excêntrica controlada |
| Plank Single-Arm Cable Row | 3 × 10 reps/lado | — | 8 | 1 min | quadril parado: nada de girar |

**Bloco 3 · AMRAP: máximo de rodadas no tempo** · 10 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Alternating Lunge | 1 × 10 reps | — | 8 | — | alternando as pernas |
| Burpee | 1 × 8 reps | — | 8 | — | — |
| Double-Under (corda) | 1 × 15 reps | — | — | — | 15 saltos duplos de corda |

### Dia 4 · Recuperação ativa (45 min)

**Bloco 1 · Recuperação ativa** · 45 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Easy Walk (zona 1 de frequência cardíaca) | 1 × 30 min | — | — | — | abaixo de 60% da FC máx. (frequência cardíaca máxima) |
| Rumble Roller (banda iliotibial, glúteo, dorsais) | 1 × 10 min | — | — | — | banda iliotibial (lateral da coxa); glúteos; dorsais; coluna torácica (meio das costas) |
| World's Greatest Stretch | 1 × 4 reps/lado | — | — | — | — |
| 90/90 Hip Switch | 1 × 6 reps/lado | — | — | — | — |
| Quadruped Thoracic Spine Rotation | 1 × 8 reps/lado | — | — | — | — |
| Brettzel Stretch | 1 × 3 reps/lado | — | — | — | 2 respirações profundas por repetição |

### Dia 5 · Tração, trapézio + pescoço (53 min)

**Bloco 1 · Preparação: mobilidade e potência** · 8 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Broad Jump | 3 × 3 reps | — | — | 1 min | aterrissagem suave |

**Bloco 2 · Força e estrutura** · 35 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Strict Pull-Up | 4 × 6–8 reps | — | 8 | 3 min | pegada pronada; lastro no cinto |
| Single-Arm Dumbbell Row | 3 × 10 reps/lado | — | 8 | 2 min | — |
| Dumbbell Shrug | 4 × 12–15 reps | — | 8 | 90 s | pesado |
| Plate Neck Curl | 3 × 15–20 reps | — | 8 | 1 min | anilha na testa, amplitude controlada |

**Bloco 3 · AMRAP: máximo de rodadas no tempo** · 10 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Seated Machine Row | 1 × 10 reps | — | 8 | — | — |
| Airdyne Bike Sprint | 1 × 15 s | — | — | — | 100% da potência máxima (watts) |
| Rowing Crunch | 1 × 10 reps | — | 8 | — | — |

### Dia 6 · Empurrar dinâmico + blindagem (55 min)

**Bloco 1 · Preparação: mobilidade e potência** · 8 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Medicine Ball Chest Pass | 3 × 5 reps | — | — | 1 min | contra a parede |

**Bloco 2 · Força e estrutura** · 35 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Dumbbell Bench Press | 4 × 8–10 reps | — | 8 | 2 min | pegada neutra |
| Dumbbell Hammer Curl | 4 × 10–12 reps | — | 8 | — (supersérie) | pesado; supersérie com o tríceps: sem descanso entre os dois |
| Cable Skullcrusher | 4 × 10–12 reps | — | 8 | 90 s | supersérie com a rosca martelo |
| Cable Lateral Raise | 3 × 12–15 reps/lado | — | 8 | 1 min | — |

**Bloco 3 · AMRAP: máximo de rodadas no tempo** · 12 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Barbell Push Press | 1 × 8 reps | — | 8 | — | leve |
| Decline Push-Up | 1 × 10 reps | — | 8 | — | — |
| Airdyne Bike Sprint | 1 × 15 s | — | — | — | 100% da potência máxima (watts) |

### Dia 7 · Pernas: volume + hipertrofia (53 min)

**Bloco 1 · Preparação: mobilidade e potência** · 8 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Jump Squat | 3 × 5 reps | — | — | 1 min | sem carga |

**Bloco 2 · Força e estrutura** · 35 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Leg Press | 4 × 10–12 reps | — | 8 | 2,5 min | — |
| Barbell Hip Thrust | 3 × 8–10 reps | — | 8 | 2 min | — |
| Ab Wheel Rollout | 3 × 8–10 reps | — | 8 | 90 s | — |

**Bloco 3 · AMRAP: máximo de rodadas no tempo** · 10 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Box Step-Up | 1 × 10 reps | — | 8 | — | alternando as pernas |
| Dumbbell Thruster | 1 × 8 reps | — | 8 | — | leve |
| Reverse Crunch | 1 × 12 reps | — | 8 | — | — |

### Dia 8 · Descanso absoluto

Repouso completo do sistema nervoso central: sem treino, sem AMRAP, sem corrida. Foco em sono, comida e recuperação dos tecidos.

## 4. Ciclos 2 a 5: o que roda

Os levantamentos primários ficam iguais em todos os ciclos. Os acessórios e o AMRAP trocam a cada ciclo, dentro do mesmo padrão de movimento (sorteio por atleta; abaixo, a semente `exemplo`). O ciclo 5 é o deload.

| Dia | Ciclo | Acessórios do Bloco 2 | AMRAP |
|---|---|---|---|
| 1 · Tração bruta + carregamento | 2 | Suitcase Carry — 3 × 40 s | Barbell Hip Thrust — 1 × 12 reps<br>Single-Arm Dumbbell Row — 1 × 12 reps/lado<br>Half-Kneeling Cable Chest Press — 1 × 12 reps/lado |
| 1 · Tração bruta + carregamento | 3 | Sled Push — 3 × 20 s | Kettlebell Swing — 1 × 10 reps<br>Inverted Row — 1 × 8 reps<br>Decline Push-Up — 1 × 10 reps |
| 1 · Tração bruta + carregamento | 4 | Suitcase Carry — 3 × 40 s | Barbell Hip Thrust — 1 × 12 reps<br>Single-Arm Dumbbell Row — 1 × 12 reps/lado<br>Dumbbell Bench Press — 1 × 12 reps |
| 1 · Tração bruta + carregamento | 5 (deload) | Dumbbell Farmer's Walk — 2 × 40 m | Kettlebell Swing — 1 × 10 reps<br>Seated Machine Row — 1 × 10 reps<br>Half-Kneeling Cable Chest Press — 1 × 12 reps/lado |
| 2 · Empurrar + largura de ombros | 2 | Cable Lateral Raise — 4 × 12 reps/lado | Airdyne Bike Sprint — 1 × 15 s<br>Kettlebell Double Front-Rack Squat — 1 × 10 reps<br>Reverse Crunch — 1 × 12 reps |
| 2 · Empurrar + largura de ombros | 3 | Dumbbell Lateral Raise — 4 × 12 reps | Airdyne Bike Sprint — 1 × 15 s<br>Wall Ball — 1 × 12 reps<br>Rowing Crunch — 1 × 10 reps |
| 2 · Empurrar + largura de ombros | 4 | Face Pull — 4 × 15 reps | Airdyne Bike Sprint — 1 × 15 s<br>Dumbbell Thruster — 1 × 8 reps<br>Reverse Crunch — 1 × 12 reps |
| 2 · Empurrar + largura de ombros | 5 (deload) | Dumbbell Lateral Raise — 2 × 12 reps | Airdyne Bike Sprint — 1 × 15 s<br>Burpee — 1 × 8 reps<br>Ab Wheel Rollout — 1 × 10 reps |
| 3 · Base de força + correção de core | 2 | Side Plank — 3 × isometria 30 s | Dumbbell Reverse Lunge — 1 × 8 reps/lado<br>Kettlebell Double Front-Rack Squat — 1 × 10 reps<br>Double-Under (corda) — 1 × 15 reps |
| 3 · Base de força + correção de core | 3 | Pallof Press — 3 × isometria 20 s | Alternating Lunge — 1 × 10 reps<br>Goblet Squat — 1 × 8 reps<br>Double-Under (corda) — 1 × 15 reps |
| 3 · Base de força + correção de core | 4 | Plank Single-Arm Cable Row — 3 × 10 reps/lado | Dumbbell Reverse Lunge — 1 × 8 reps/lado<br>Kettlebell Double Front-Rack Squat — 1 × 10 reps<br>Double-Under (corda) — 1 × 15 reps |
| 3 · Base de força + correção de core | 5 (deload) | Side Plank — 2 × isometria 30 s | Lateral Squat — 1 × 6 reps/lado<br>Jump Squat — 1 × 10 reps<br>Double-Under (corda) — 1 × 15 reps |
| 5 · Tração, trapézio + pescoço | 2 | Trap Bar Shrug — 4 × 12 reps | Inverted Row — 1 × 15 reps<br>Airdyne Bike Sprint — 1 × 15 s<br>Reverse Crunch — 1 × 12 reps |
| 5 · Tração, trapézio + pescoço | 3 | Dumbbell Shrug — 4 × 12–15 reps | Chest-Supported Dumbbell Row — 1 × 12 reps<br>Airdyne Bike Sprint — 1 × 15 s<br>Ab Wheel Rollout — 1 × 10 reps |
| 5 · Tração, trapézio + pescoço | 4 | Trap Bar Shrug — 4 × 12 reps | Inverted Row — 1 × 15 reps<br>Airdyne Bike Sprint — 1 × 15 s<br>Rowing Crunch — 1 × 10 reps |
| 5 · Tração, trapézio + pescoço | 5 (deload) | Dumbbell Shrug — 2 × 12–15 reps | Chest-Supported Dumbbell Row — 1 × 12 reps<br>Airdyne Bike Sprint — 1 × 15 s<br>V-Up — 1 × 15 reps |
| 6 · Empurrar dinâmico + blindagem | 2 | Dumbbell Lateral Raise — 3 × 15 reps | Seated Dumbbell Shoulder Press — 1 × 12 reps<br>Half-Kneeling Cable Chest Press — 1 × 12 reps/lado<br>Airdyne Bike Sprint — 1 × 15 s |
| 6 · Empurrar dinâmico + blindagem | 3 | Cable Lateral Raise — 3 × 12–15 reps/lado | Barbell Push Press — 1 × 8 reps<br>Decline Push-Up — 1 × 10 reps<br>Airdyne Bike Sprint — 1 × 15 s |
| 6 · Empurrar dinâmico + blindagem | 4 | Dumbbell Lateral Raise — 3 × 15 reps | Seated Dumbbell Shoulder Press — 1 × 12 reps<br>Half-Kneeling Cable Chest Press — 1 × 12 reps/lado<br>Airdyne Bike Sprint — 1 × 15 s |
| 6 · Empurrar dinâmico + blindagem | 5 (deload) | Band Pull-Apart — 2 × 20 reps | Barbell Push Press — 1 × 8 reps<br>Push-Up — 1 × 20 reps<br>Airdyne Bike Sprint — 1 × 15 s |
| 7 · Pernas: volume + hipertrofia | 2 | Alternating Hanging Knee-Up — 3 × 8 reps/lado | Dumbbell Reverse Lunge — 1 × 8 reps/lado<br>Kettlebell Double Front-Rack Squat — 1 × 10 reps<br>Rowing Crunch — 1 × 10 reps |
| 7 · Pernas: volume + hipertrofia | 3 | Ab Wheel Rollout — 3 × 8–10 reps | Lateral Squat — 1 × 6 reps/lado<br>Wall Ball — 1 × 12 reps<br>Alternating Hanging Knee-Up — 1 × 12 reps/lado |
| 7 · Pernas: volume + hipertrofia | 4 | Alternating Hanging Knee-Up — 3 × 8 reps/lado | Dumbbell Reverse Lunge — 1 × 8 reps/lado<br>Burpee — 1 × 8 reps<br>V-Up — 1 × 15 reps |
| 7 · Pernas: volume + hipertrofia | 5 (deload) | Ab Wheel Rollout — 2 × 8–10 reps | Alternating Lunge — 1 × 10 reps<br>Kettlebell Double Front-Rack Squat — 1 × 10 reps<br>Alternating Hanging Knee-Up — 1 × 12 reps/lado |

## 5. Perguntas para o avaliador

1. O ciclo **3 treinos / recuperação / 3 treinos / descanso** dá recuperação suficiente para o volume pesado dos dias
   1–3, em especial supino e agachamento em dias seguidos (dias 2 e 3)?
2. O **volume semanal por grupo** está equilibrado? Há dois dias de empurrar (2 e 6), dois de puxar (1 e 5) e dois de
   pernas (3 e 7).
3. **Top set a esforço 8,5 + back-off a 80%** é uma boa estrutura para os primários? 80% do top set de 5 reps dá
   conta de 3×8 a esforço 7,5?
4. Os **descansos por exercício** (3–4 min, 2 min, 90 s, 60 s) estão bem calibrados?
5. **+2 kg por ciclo no agachamento** é sustentável por 5 ciclos seguidos, ou deveria depender do RPE registrado?
6. Os ajustes de **dia vermelho** (sem AMRAP e metade das séries) e de **deload** (×0,6 das séries, esforço −2, AMRAP
   de 10 min a 50% da carga) estão proporcionais?
7. A **rotação dos acessórios e do AMRAP** a cada ciclo ajuda ou atrapalha, considerando que os primários ficam fixos?
