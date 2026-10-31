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
| Rotação torácica em quatro apoios | 1 × 2 min | — | — | — | — |
| Arremesso de medicine ball no chão | 3 × 5 reps | — | — | 1 min | arremesso contra o solo |

**Bloco 2 · Força e estrutura** · 35 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Remada curvada com barra | 1 × 5 reps | — | 8,5 | 3 min | top set |
| Remada curvada com barra | 3 × 8 reps | — | 7,5 | 3 min | back-off |
| Puxada frontal aberta | 3 × 8–10 reps | — | 8 | 2 min | pela frente |
| Caminhada do fazendeiro | 3 × 40 m | — | 8 | 2 min | pesado |

**Bloco 3 · AMRAP: máximo de rodadas no tempo** · 10 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Kettlebell swing | 1 × 10 reps | — | 8 | — | — |
| Remada invertida | 1 × 8 reps | — | 8 | — | no TRX ou na barra baixa |
| Flexão de braço | 1 × 10 reps | — | 8 | — | — |

### Dia 2 · Empurrar + largura de ombros (55 min)

**Bloco 1 · Preparação: mobilidade e potência** · 8 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Mobilidade de ombro com elástico | 1 × 3 min | — | — | — | deslocamentos com elástico; rotações externas |
| Salto na caixa | 3 × 4 reps | — | — | 1 min | aterrissagem suave; desça caminhando |

**Bloco 2 · Força e estrutura** · 35 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Supino reto com barra | 1 × 5 reps | — | 8,5 | 3,5 min | top set |
| Supino reto com barra | 3 × 8 reps | — | 7,5 | 3,5 min | back-off |
| Desenvolvimento sentado com halteres | 3 × 8–10 reps | — | 8 | 2 min | pegada semi-neutra |
| Elevação lateral com halteres | 4 × 12 reps | — | 8 | 90 s | — |

**Bloco 3 · AMRAP: máximo de rodadas no tempo** · 12 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Tiro na bike | 1 × 15 s | — | — | — | 100% da potência máxima (watts) |
| Wall ball | 1 × 12 reps | — | 8 | — | — |
| Canivete (V-up) | 1 × 15 reps | — | 8 | — | — |

### Dia 3 · Base de força + correção de core (60 min)

**Bloco 1 · Preparação: mobilidade e potência** · 10 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Troca de quadril 90/90 | 1 × 4 min | — | — | — | mobilidade de quadril profunda |
| Tiro curto de corrida | 5 × 20 m | — | — | 90 s | velocidade máxima |

**Bloco 2 · Força e estrutura** · 40 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Agachamento livre com barra | 4 × 5–8 reps | — | 8 | 3,5 min | — |
| Stiff com barra | 3 × 8–10 reps | 3-0-1-0 | 8 | 2 min | excêntrica controlada |
| Remada na polia em prancha | 3 × 10 reps/lado | — | 8 | 1 min | quadril parado: nada de girar |

**Bloco 3 · AMRAP: máximo de rodadas no tempo** · 10 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Afundo alternado | 1 × 10 reps | — | 8 | — | alternando as pernas |
| Burpee | 1 × 8 reps | — | 8 | — | — |
| Pular corda (salto duplo) | 1 × 15 reps | — | — | — | 15 saltos duplos de corda |

### Dia 4 · Recuperação ativa (45 min)

**Bloco 1 · Recuperação ativa** · 45 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Caminhada leve (zona 1) | 1 × 30 min | — | — | — | abaixo de 60% da FC máx. (frequência cardíaca máxima) |
| Rolo de liberação: corpo inteiro | 1 × 10 min | — | — | — | banda iliotibial (lateral da coxa); glúteos; dorsais; coluna torácica (meio das costas) |
| World's Greatest Stretch | 1 × 4 reps/lado | — | — | — | — |
| Troca de quadril 90/90 | 1 × 6 reps/lado | — | — | — | — |
| Rotação torácica em quatro apoios | 1 × 8 reps/lado | — | — | — | — |
| Alongamento Brettzel | 1 × 3 reps/lado | — | — | — | 2 respirações profundas por repetição |

### Dia 5 · Tração, trapézio + pescoço (53 min)

**Bloco 1 · Preparação: mobilidade e potência** · 8 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Salto horizontal | 3 × 3 reps | — | — | 1 min | aterrissagem suave |

**Bloco 2 · Força e estrutura** · 35 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Barra fixa pronada | 4 × 6–8 reps | — | 8 | 3 min | pegada pronada; lastro no cinto |
| Remada unilateral com halter (serrote) | 3 × 10 reps/lado | — | 8 | 2 min | — |
| Encolhimento com halteres | 4 × 12–15 reps | — | 8 | 90 s | pesado |
| Flexão de pescoço com anilha | 3 × 15–20 reps | — | 8 | 1 min | anilha na testa, amplitude controlada |

**Bloco 3 · AMRAP: máximo de rodadas no tempo** · 10 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Remada sentada na máquina | 1 × 10 reps | — | 8 | — | — |
| Tiro na bike | 1 × 15 s | — | — | — | 100% da potência máxima (watts) |
| Abdominal remador | 1 × 10 reps | — | 8 | — | — |

### Dia 6 · Empurrar dinâmico + blindagem (55 min)

**Bloco 1 · Preparação: mobilidade e potência** · 8 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Passe de peito com medicine ball | 3 × 5 reps | — | — | 1 min | contra a parede |

**Bloco 2 · Força e estrutura** · 35 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Supino reto com halteres | 4 × 8–10 reps | — | 8 | 2 min | pegada neutra |
| Rosca martelo | 4 × 10–12 reps | — | 8 | — (supersérie) | pesado; supersérie com o tríceps: sem descanso entre os dois |
| Tríceps testa na polia | 4 × 10–12 reps | — | 8 | 90 s | supersérie com a rosca martelo |
| Elevação lateral na polia | 3 × 12–15 reps/lado | — | 8 | 1 min | — |

**Bloco 3 · AMRAP: máximo de rodadas no tempo** · 12 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Push press com barra | 1 × 8 reps | — | 8 | — | leve |
| Flexão declinada | 1 × 10 reps | — | 8 | — | — |
| Tiro na bike | 1 × 15 s | — | — | — | 100% da potência máxima (watts) |

### Dia 7 · Pernas: volume + hipertrofia (53 min)

**Bloco 1 · Preparação: mobilidade e potência** · 8 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Agachamento com salto | 3 × 5 reps | — | — | 1 min | sem carga |

**Bloco 2 · Força e estrutura** · 35 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Leg press | 4 × 10–12 reps | — | 8 | 2,5 min | — |
| Elevação pélvica com barra | 3 × 8–10 reps | — | 8 | 2 min | — |
| Roda abdominal | 3 × 8–10 reps | — | 8 | 90 s | — |

**Bloco 3 · AMRAP: máximo de rodadas no tempo** · 10 min

| Exercício | Volume | Tempo | RPE alvo | Descanso | Observações |
|---|---|---|---|---|---|
| Subida no banco | 1 × 10 reps | — | 8 | — | alternando as pernas |
| Thruster com halteres | 1 × 8 reps | — | 8 | — | leve |
| Abdominal reverso | 1 × 12 reps | — | 8 | — | — |

### Dia 8 · Descanso absoluto

Repouso completo do sistema nervoso central: sem treino, sem AMRAP, sem corrida. Foco em sono, comida e recuperação dos tecidos.

## 4. Ciclos 2 a 5: o que roda

Os levantamentos primários ficam iguais em todos os ciclos. Os acessórios e o AMRAP trocam a cada ciclo, dentro do mesmo padrão de movimento (sorteio por atleta; abaixo, a semente `exemplo`). O ciclo 5 é o deload.

> **Desatualizado em 2026-10-30:** o catálogo ganhou ~60 exercícios de máquina, smith e polia, então o sorteio
> dos ciclos 2 a 5 mudou. A tabela abaixo mostra o sorteio do catálogo antigo (com os nomes já traduzidos); as regras
> e o ciclo 1 continuam valendo.

| Dia | Ciclo | Acessórios do Bloco 2 | AMRAP |
|---|---|---|---|
| 1 · Tração bruta + carregamento | 2 | Caminhada unilateral (mala) — 3 × 40 s | Elevação pélvica com barra — 1 × 12 reps<br>Remada unilateral com halter (serrote) — 1 × 12 reps/lado<br>Supino unilateral na polia (meio ajoelhado) — 1 × 12 reps/lado |
| 1 · Tração bruta + carregamento | 3 | Empurrar trenó — 3 × 20 s | Kettlebell swing — 1 × 10 reps<br>Remada invertida — 1 × 8 reps<br>Flexão declinada — 1 × 10 reps |
| 1 · Tração bruta + carregamento | 4 | Caminhada unilateral (mala) — 3 × 40 s | Elevação pélvica com barra — 1 × 12 reps<br>Remada unilateral com halter (serrote) — 1 × 12 reps/lado<br>Supino reto com halteres — 1 × 12 reps |
| 1 · Tração bruta + carregamento | 5 (deload) | Caminhada do fazendeiro — 2 × 40 m | Kettlebell swing — 1 × 10 reps<br>Remada sentada na máquina — 1 × 10 reps<br>Supino unilateral na polia (meio ajoelhado) — 1 × 12 reps/lado |
| 2 · Empurrar + largura de ombros | 2 | Elevação lateral na polia — 4 × 12 reps/lado | Tiro na bike — 1 × 15 s<br>Agachamento com 2 kettlebells (front rack) — 1 × 10 reps<br>Abdominal reverso — 1 × 12 reps |
| 2 · Empurrar + largura de ombros | 3 | Elevação lateral com halteres — 4 × 12 reps | Tiro na bike — 1 × 15 s<br>Wall ball — 1 × 12 reps<br>Abdominal remador — 1 × 10 reps |
| 2 · Empurrar + largura de ombros | 4 | Face pull — 4 × 15 reps | Tiro na bike — 1 × 15 s<br>Thruster com halteres — 1 × 8 reps<br>Abdominal reverso — 1 × 12 reps |
| 2 · Empurrar + largura de ombros | 5 (deload) | Elevação lateral com halteres — 2 × 12 reps | Tiro na bike — 1 × 15 s<br>Burpee — 1 × 8 reps<br>Roda abdominal — 1 × 10 reps |
| 3 · Base de força + correção de core | 2 | Prancha lateral — 3 × isometria 30 s | Afundo reverso com halteres — 1 × 8 reps/lado<br>Agachamento com 2 kettlebells (front rack) — 1 × 10 reps<br>Pular corda (salto duplo) — 1 × 15 reps |
| 3 · Base de força + correção de core | 3 | Pallof press — 3 × isometria 20 s | Afundo alternado — 1 × 10 reps<br>Agachamento goblet — 1 × 8 reps<br>Pular corda (salto duplo) — 1 × 15 reps |
| 3 · Base de força + correção de core | 4 | Remada na polia em prancha — 3 × 10 reps/lado | Afundo reverso com halteres — 1 × 8 reps/lado<br>Agachamento com 2 kettlebells (front rack) — 1 × 10 reps<br>Pular corda (salto duplo) — 1 × 15 reps |
| 3 · Base de força + correção de core | 5 (deload) | Prancha lateral — 2 × isometria 30 s | Agachamento lateral — 1 × 6 reps/lado<br>Agachamento com salto — 1 × 10 reps<br>Pular corda (salto duplo) — 1 × 15 reps |
| 5 · Tração, trapézio + pescoço | 2 | Encolhimento com trap bar — 4 × 12 reps | Remada invertida — 1 × 15 reps<br>Tiro na bike — 1 × 15 s<br>Abdominal reverso — 1 × 12 reps |
| 5 · Tração, trapézio + pescoço | 3 | Encolhimento com halteres — 4 × 12–15 reps | Remada com halteres apoiada no banco — 1 × 12 reps<br>Tiro na bike — 1 × 15 s<br>Roda abdominal — 1 × 10 reps |
| 5 · Tração, trapézio + pescoço | 4 | Encolhimento com trap bar — 4 × 12 reps | Remada invertida — 1 × 15 reps<br>Tiro na bike — 1 × 15 s<br>Abdominal remador — 1 × 10 reps |
| 5 · Tração, trapézio + pescoço | 5 (deload) | Encolhimento com halteres — 2 × 12–15 reps | Remada com halteres apoiada no banco — 1 × 12 reps<br>Tiro na bike — 1 × 15 s<br>Canivete (V-up) — 1 × 15 reps |
| 6 · Empurrar dinâmico + blindagem | 2 | Elevação lateral com halteres — 3 × 15 reps | Desenvolvimento sentado com halteres — 1 × 12 reps<br>Supino unilateral na polia (meio ajoelhado) — 1 × 12 reps/lado<br>Tiro na bike — 1 × 15 s |
| 6 · Empurrar dinâmico + blindagem | 3 | Elevação lateral na polia — 3 × 12–15 reps/lado | Push press com barra — 1 × 8 reps<br>Flexão declinada — 1 × 10 reps<br>Tiro na bike — 1 × 15 s |
| 6 · Empurrar dinâmico + blindagem | 4 | Elevação lateral com halteres — 3 × 15 reps | Desenvolvimento sentado com halteres — 1 × 12 reps<br>Supino unilateral na polia (meio ajoelhado) — 1 × 12 reps/lado<br>Tiro na bike — 1 × 15 s |
| 6 · Empurrar dinâmico + blindagem | 5 (deload) | Abertura com elástico — 2 × 20 reps | Push press com barra — 1 × 8 reps<br>Flexão de braço — 1 × 20 reps<br>Tiro na bike — 1 × 15 s |
| 7 · Pernas: volume + hipertrofia | 2 | Elevação alternada de joelhos na barra — 3 × 8 reps/lado | Afundo reverso com halteres — 1 × 8 reps/lado<br>Agachamento com 2 kettlebells (front rack) — 1 × 10 reps<br>Abdominal remador — 1 × 10 reps |
| 7 · Pernas: volume + hipertrofia | 3 | Roda abdominal — 3 × 8–10 reps | Agachamento lateral — 1 × 6 reps/lado<br>Wall ball — 1 × 12 reps<br>Elevação alternada de joelhos na barra — 1 × 12 reps/lado |
| 7 · Pernas: volume + hipertrofia | 4 | Elevação alternada de joelhos na barra — 3 × 8 reps/lado | Afundo reverso com halteres — 1 × 8 reps/lado<br>Burpee — 1 × 8 reps<br>Canivete (V-up) — 1 × 15 reps |
| 7 · Pernas: volume + hipertrofia | 5 (deload) | Roda abdominal — 2 × 8–10 reps | Afundo alternado — 1 × 10 reps<br>Agachamento com 2 kettlebells (front rack) — 1 × 10 reps<br>Elevação alternada de joelhos na barra — 1 × 12 reps/lado |

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
