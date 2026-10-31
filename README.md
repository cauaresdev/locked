# Project Knightfall

Implementação do protocolo **Joint-Friendly Heavy Chaos** (preparação BvS) + dieta
**Six Pack Diet Plan (Rehan Jalali)**, com programas montados para academias de máquinas, uma rotina diária de
saúde no estilo da preparação do Batman e integração de wearables.

No app: **Hoje** (treino do dia, rotina e prontidão), **Rotina** (hábitos do dia e Early Bird), **Nutrição**,
**Progresso** e **Perfil**.

```
backend/   FastAPI + SQLAlchemy + Alembic — motor de regras, nutrição, telemetria, API autenticada
mobile/    Expo SDK 57 (React Native + TypeScript) — app offline-first
```

## Módulos

### Treino
| Módulo | Onde | Regra |
|---|---|---|
| Ciclo assíncrono | `knightfall/tiers.py`, `generator.locate` | Brawler 8 dias (6 on / 2 off); Dark Knight 5/7; Vigilante 4/7. |
| Sessão tripartida | `generator.py` | Bloco 1 prep (trava obrigatória) → Bloco 2 força → Bloco 3 AMRAP. Dia 1 do ciclo 0 = sessão documentada (94 min). |
| Chaos Engine | `chaos.py`, `templates.py`, `catalog.py` | Padrão fixo por slot; a cada ciclo troca exercício **e** implemento ou modalidade (num slot com um só exercício, como o sprint, alterna a modalidade). Determinístico por seed e independente da ordem do catálogo; um teste de agenda "golden" trava o sorteio, então mudar o catálogo é sempre deliberado. Datas fora de 2000–2100 ou mais de 10 anos após o início do ciclo respondem 422. |
| Programas | `tiers.py` | Na API ainda se chamam *tiers*. Funcionais: Vigilante 45 min ×0,5 séries · Dark Knight 60 min ×0,75 · Brawler integral, com termo e aviso após 16 semanas. De máquina (`splits.py`): Full Body 3×, Upper/Lower 4×, Push/Pull/Legs 6× e Batfleck 5× (hipertrofia BvS: peito, costas, pernas, ombros com trapézio e pescoço, braços). Atléticos (`splits.py`, semanais, dia 1 = segunda): Armadura de Gotham 5× (proporção em V, metas de séries próprias por músculo), Functional Bodybuilding de Walter Norton Jr. 4× (superior/inferior com carregamentos) e Conjugado tático 4× (esforço máximo e dinâmico, com aviso quando o atleta está abaixo de 1,8× / 2,2× o peso do corpo no agachamento / terra). |
| Programas de máquina | `splits.py` | Cada dia é escrito vaga por vaga. A vaga lista opções em ordem de preferência (máquina → smith → halteres/barra → peso corporal) e usa a primeira que o perfil de equipamentos tem; sem nenhuma, entram os substitutos da vaga e, por último, qualquer exercício disponível do mesmo padrão. O bloco Principal é fixo (a carga progride); os acessórios giram a cada ciclo pela lista, começando num ponto diferente em cada dia. Sem semente: a escolha depende só de (dia, vaga, ciclo, equipamentos). Blocos: Aquecimento (checklist obrigatório), Potência (saltos, arremessos e sprints, sempre logo depois do aquecimento, 90–180 s de descanso, sem esforço alvo), Principal, Acessórios e, em alguns dias, Finalizador (caminhada inclinada). Dias com sprint ou agilidade ficam a 48 h do agachamento/terra pesado (teste em todos os programas). Esforço alvo por vaga a partir do RIR do protocolo (RIR 1 = esforço 9). Carregamentos em metros quando o programa pede. No Conjugado, o exercício de esforço máximo alterna toda semana. Top set + back-off a 80% no Upper/Lower e no Batfleck. Prontidão vermelha: 60% das séries, sem finalizador, aquecimento maior. Deload a cada 6 ciclos. A descrição treino a treino está em `docs/programas.md`, gerado por `backend/scripts/gen_programs_doc.py`. |
| Metrônomo | `mobile/src/engine/tempo.ts`, `hooks/useMetronome.ts` | Bipe + háptico por segundo, bipe forte na troca de fase. |
| Autorregulação de carga | `strength.py`, `progression.py` | 1RM estimado (carga máxima para 1 repetição) pela tabela de RPE (esforço percebido) por repetições em reserva → carga para as repetições e o esforço alvo. Só séries retas de força/hipertrofia estimam o 1RM (tempo, explosivo e isométrico ficam de fora; a série registra a modalidade), usando os 3 últimos dias do exercício dentro de 60 dias. Trabalho explosivo é prescrito a 65% do 1RM. Em exercícios com peso corporal, o peso entra na massa total. Fallback por esforço para carregamentos/trenó: sobe pelo menos um incremento; se passou do esforço, desce ~5% arredondado ao incremento mais próximo (com kettlebell, 4 kg costuma ser demais, então a carga se mantém). No app, o esforço **não vem preenchido**: é um seletor obrigatório de 6 a 10. |
| Batsuit Readiness | `readiness.py` | VFC (variabilidade da frequência cardíaca): média de 7 dias de ln(VFC) vs. linha de base de 60 dias, alerta abaixo de 0,5 desvio padrão (Plews/Buchheit); antes de 14 leituras, compara com a semana anterior. Mesmo método sempre (SDNN ≠ RMSSD). Mais sono e dor. O ACWR (razão de carga aguda:crônica) de lombar e ombro não entra na nota: acima de 1,5 só rebaixa um dia verde para amarelo, nunca força vermelho, e só existe com 21+ dias de histórico de treino (a média crônica cobre os dias desde o primeiro treino registrado, até 28). Antes de 14 leituras, uma VFC até 5% abaixo da semana anterior conta como normal. Vermelho → Bloco 1 expandido (Brawler 32 → 45 min, Dark Knight 16 → 24, Vigilante 12 → 18). |
| Armor Load | `armor.py` | Capacidade de Carga Operacional (kg·m, quilos × metros): carregamentos, trenó e barra fixa (peso corporal + lastro, se houver; sem lastro também conta, porque o corpo é a carga). |
| Deload | `generator.py`, `tiers.py`, `services.py` | Semana de descarga a cada 5 ciclos no Brawler e 6 nos outros, ou após 3 dias seguidos de prontidão vermelha — nesse caso vale por um ciclo inteiro (8 ou 7 dias) a partir do terceiro dia, derivado do histórico de prontidão: séries do Bloco 2 ×0,6 e esforço alvo −2. |
| Equipamentos | `domain.py`, `chaos.py` | Perfil do que a academia tem. Máquinas são listadas por estação (leg press, hack, smith, extensora, flexora, panturrilha, abdutora/adutora, puxador, remada, supino máquina, voador, desenvolvimento máquina); um perfil antigo com "máquina" vale por todas. O sorteio só usa esses implementos (peso corporal sempre). Quando o perfil deixa um padrão sem opção, entram substitutos com peso corporal (caminhada/trote, flexão pike, agachamento livre, hip thrust unilateral, bear crawl, mountain climber…); se nem assim houver (rolo de liberação), o exercício entra e a sessão avisa qual implemento falta. Na sessão, "Trocar exercício" lista alternativas do mesmo padrão de movimento, substitutos inclusos (`/sessions/{dia}/alternatives`). |
| Registro de série | `generator.history_fields`, `SetRunner.tsx` | Cada exercício mostra a última vez (data, carga × reps, esforço) e o recorde (maior 1RM estimado; peso corporal fica de fora). No primeiro exercício pesado e no top set, aquecimento com carga calculada (50% × 8 e 75% × 3, arredondado ao incremento). Barra, smith, leg press e hack mostram as anilhas por lado. Ao registrar uma série que bate o recorde, aviso por voz, vibração e banner. O back-off começa em 80% do top set **feito**, não do planejado. No fim, resumo com duração, séries, volume (kg × reps) e recordes. |
| Séries por músculo | `volume.py`, aba Progresso | Séries diretas dos últimos 7 dias por músculo (cada série conta para o músculo principal do movimento), contra a faixa de 10–20 por semana. |
| Treino perdido | `routes_training.py` | `/cycle/missed` detecta dias de treino sem séries; "Repor hoje" empurra o ciclo (`/cycle/shift`) para fazer o treino perdido. |
| Desfazer série | `mobile/src/storage/db.ts`, `DELETE /logs/{id}` | Tira da fila offline se ainda não subiu; senão enfileira a exclusão no servidor. |
| Progresso | `routes_progress.py`, aba Progresso | Gráficos de 1RM estimado por exercício, peso (pesagens + média de 7 dias), prontidão, sono, VFC, carga por ciclo, calorias e proteína vs. meta, frequência. Cada gráfico tem visão em tabela. |

### Corpo
- **Medidas** (aba Progresso): pescoço, ombros, peito, braço, cintura, quadril, coxa e panturrilha, com gráfico e variação. `GET/PUT /athletes/{id}/measurements`; tabela `body_measurements` (migração 0008).

### Nutrição (`knightfall/nutrition.py`, `foods.py`)
- **Objetivo** (aba Nutrição): Secar (Jalali, 12–14 kcal/lb de massa magra), Manter (15–17) ou Ganhar massa (17–19). As faixas de manter e ganhar são estimativas do app, não do protocolo; a proteína continua presa à massa magra.
- **Crescimento limpo** (Jalali otimizado, `cycle_targets`): proteína 2,0–2,2 g/kg e gordura 0,8–1,0 g/kg (nunca abaixo de 20% das calorias) todo dia; carboidrato ciclado pelo treino planejado do dia: pernas, força máxima ou sprint 4–5 g/kg, superior 3–3,5 g/kg, descanso 2–2,5 g/kg (o app usa o meio de cada faixa). Refeição pré-treino; 60% do carboidrato no pré e no pós-treino. Sem toque de recolher de carboidrato, sem alerta de laticínio e sem teto de sódio por refeição; sódio do dia entre 3.000 e 4.000 mg. Água da Rotina em 45 ml/kg.
- **Calorias:** 12 kcal/lb de massa magra + gasto do treino do dia, com teto de 14 kcal/lb.
  - O gasto vem da frequência cardíaca medida (fórmula de Keytel) fora do bloco de força; **dentro** dele (janela pelo horário das séries) usa MET 5 (equivalente metabólico), porque a FC na musculação sobe sem consumo de oxigênio proporcional e Keytel superestima. Sem cinta, estimativa por MET do treino planejado.
  - Sempre gasto **líquido**: o repouso (1 MET) já está nas 12 kcal/lb, então é descontado, e amostras abaixo de 50% da FC máx. (90 bpm sem FC máx.) não contam.
- **Peso:** pesagens diárias (manuais ou da balança via Apple Health / Health Connect); a **média de 7 dias** vira o peso usado em todas as metas.
- **Massa magra:** calculada pelo % de gordura; sem ele, pela fórmula de Boer (altura e sexo), limitada a 50–95% do peso; sem nenhum dos dois, assumida e sinalizada no app.
- **Carb curfew:** carboidratos só no café e no pós-treino. Lanche e jantar ficam com meta de 0 g. Vegetais fibrosos (categoria "vegetal": crucíferos como brócolis e couve-de-bruxelas, e folhas como espinafre) não contam no alerta; o resto tolera 10 g. A regra usa a categoria, e não só crucíferos, porque alimentos escaneados ou digitados trazem a categoria, não a família botânica.
- **Laticínios:** usa principalmente o alérgeno `en:milk` do Open Food Facts e, nos ingredientes, palavras inteiras em inglês, português, espanhol e francês (whey, caseína, queijo, manteiga, nata, requeijão, fromage, leche…). Ignora falsos positivos como leite de coco, manteiga de cacau/amendoim, tofu (bean curd) e cremor tártaro. Whey isolado hidrolisado é a única exceção permitida: precisa de um ingrediente que seja whey isolado **e** hidrolisado, e nenhum outro laticínio (um blend com concentrado continua "contém").
- **Sódio:** teto de 1.500–2.000 mg/dia. Alerta vermelho quando uma refeição passa de 500 mg, já calculado no scanner considerando o que a refeição já tem.
- **Suplementos:** checklist com óleo de linhaça 2×, CLA (ácido linoleico conjugado) nas refeições, whey isolado com água e creatina 5 g/dia (esta fora do plano Jalali). No Crescimento limpo: creatina 5–7 g, ômega-3 2–3 g de EPA+DHA, D3+K2, whey isolado, magnésio bisglicinato à noite e, só nos dias com saltos ou sprints, colágeno 15 g + vitamina C 500 mg 45 min antes do treino.
- **Divisão de macros:** proteína 1,1 g/lb de massa magra e gordura ≥ 25%. **Essa divisão é escolha do app, não do protocolo.**

### Wearables e telemetria
- **Cinta cardíaca e bike** (`mobile/src/ble`, via `react-native-ble-manager`):
  - Heart Rate Service 0x180D, FTMS Indoor Bike 0x2AD2 e Cycling Power 0x2A63.
  - Reconecta sozinho e grava amostras a 1 Hz numa fila offline.
- **Apple Health / Health Connect** (`mobile/src/health`): VFC, FC de repouso e sono da última noite alimentam o Readiness.
  - Garmin, Oura e Whoop entram pela sincronização do app do fabricante com o Health / Health Connect.
- **Telemetria:** tabela `telemetry_samples`, que vira hypertable TimescaleDB quando o Postgres tem a extensão (migração 0002) e é comprimida depois de 7 dias (migração 0004). Na mesma rota ficam o resumo por zona, as kcal e a potência.

### Rotina Batfleck (`knightfall/routine.py`, aba Rotina)
- Hábitos do dia em três partes: **manhã** (sono da noite, acordar no horário, 500 ml de água, cardio em jejum, sol,
  banho frio opcional), **dia** (água, treino, suplementos, passos) e **noite** (mobilidade, desacelerar opcional,
  telas desligadas, cama no horário).
- **Marca sozinho** o que o app já sabe: sono da noite (registro de prontidão ou relógio) ≥ meta − 15 min, check-in do
  Early Bird até 30 min depois do alarme, janela do cardio em jejum cumprida, séries registradas no dia, checklist
  de suplementos completo. O resto é marcado à mão.
- **Água:** 35 ml/kg, +500 ml em dia de treino, arredondado para 250 ml.
- **Horários:** cama = acordar − meta de sono (6–10 h, padrão 8 h); telas desligadas 1 h antes.
- **Dia cumprido** com 80% dos hábitos; sequência e recorde dos últimos 60 dias. Só os últimos 7 dias podem ser
  editados.
- **Lembretes locais:** água 3 vezes entre acordar e a hora das telas, telas desligadas e hora de dormir.
- **Mobilidade e respiração guiadas:** 4 exercícios de 2 min e respiração 4-7-8 (~9 min), com voz a cada troca e tela acesa; ao terminar, marca a mobilidade na rotina (`engine/guided.ts`).
- Itens opcionais ligam e desligam em Rotina › Personalizar (`routine_items`); sono, água e treino são fixos.
- API: `GET /athletes/{id}/routine/{dia}` e `PUT /athletes/{id}/routine/{dia}/items/{item}` (`done` ou, para a água,
  `value` em ml). Tabela `routine_checks` (migração 0007).

### Gotham Early Bird (`knightfall/early_bird.py`)
- Alarme diário via notificação local, com som próprio e canal Android de importância máxima.
- O check-in "acordei" abre uma janela de 30 min. Dentro dela é preciso acumular 20 min com FC entre 70% e 80% da FC máx. (alvo de ~75%), medida pela cinta.
- O servidor valida a janela e calcula a sequência de dias cumpridos (uma janela de hoje que fechou sem os 20 min zera a sequência na hora).
- No app, abre pela aba Rotina; a voz avisa quando você entra, sai acima ou fica abaixo da zona.

### Conta e segurança
- **Login:** e-mail e senha (hash scrypt, sem dependências extras). O token opaco é guardado só como hash, vale 90 dias e o logout o revoga.
- **Isolamento entre usuários:** cada usuário acessa apenas o próprio atleta; o atleta de outra pessoa responde 404.
- **Limite de tentativas:** 5 logins errados por e-mail e 30 por IP a cada 15 min, e 20 cadastros por IP por hora (429 com `Retry-After`). O contador fica em memória, por processo, e descarta as chaves vencidas (não cresce sem limite). Atrás de um proxy, defina `FORWARDED_ALLOW_IPS` com o endereço dele; senão todos os clientes contam como o IP do proxy.
- **Sessões vencidas:** cada login novo apaga os tokens expirados do usuário.
- **E-mail inexistente:** o login faz o mesmo trabalho de scrypt e devolve a mesma resposta, então o tempo não revela quais e-mails têm conta.
- **CORS:** desligado por padrão (o app nativo não precisa). Para um cliente web, liste as origens em `KNIGHTFALL_CORS_ORIGINS`.
- **No app:** o token fica no Secure Store. Um 401 volta para o login **sem apagar** a fila offline, que sobe quando o mesmo usuário entra de novo. Os dados locais só são apagados quando outra conta entra, ou no "Sair" (que tenta sincronizar antes e avisa se algo ficaria para trás).
- **Sincronização:** quando o servidor recusa um lote (400/413/422), o app divide o lote até isolar os itens inválidos. Esses itens vão para uma tabela de recusados ("N recusados" na tela Hoje) e o resto da fila segue.
- **Lotes no servidor:** no máximo 500 séries ou alimentos e 5.000 amostras de telemetria por requisição (422 antes de qualquer trabalho). A gravação é `INSERT … ON CONFLICT DO NOTHING`, então reenvios simultâneos do mesmo lote não colidem; um id que já pertence a outro atleta responde 422 em vez de ser contado como duplicado (o que descartaria o dado em silêncio).
- **Entradas numéricas:** NaN e ±Infinito são recusados, e cargas, repetições, calorias, sódio etc. têm teto realista. Horários (`performed_at`, `ts`, `woke_at`) exigem fuso e ficam entre 2000 e 2100.

### LGPD (Lei Geral de Proteção de Dados)
- **Consentimento:** o onboarding exige autorizar o tratamento dos dados de saúde; o horário fica em `health_consent_at`.
- **Portabilidade:** `GET /auth/export` devolve tudo em JSON, transmitido tabela a tabela (a memória do servidor não cresce com meses de telemetria); no app, Perfil › Exportar meus dados gera um arquivo para compartilhar.
- **Exclusão:** `DELETE /auth/account` (com a senha) apaga a conta e todos os registros; no app, Perfil › Excluir minha conta.

### Observabilidade
- Um log JSON por requisição (método, rota-modelo sem IDs, status, duração, `x-request-id`). Corpos nunca entram no log — carregam dados de saúde. Nível em `KNIGHTFALL_LOG_LEVEL`.
- Erros não tratados vão para o Sentry quando `SENTRY_DSN` está definido (extra `observability`, já incluso na imagem Docker). Sem corpo de requisição, sem variáveis locais, sem query string e só cabeçalhos inofensivos; o SQLAlchemy roda com `hide_parameters`, então os valores de um comando que falhou também não aparecem nas mensagens de erro.
- Um `x-request-id` enviado pelo cliente só é reaproveitado se for curto e opaco (`[A-Za-z0-9_.-]{1,64}`).
- `GET /health` testa o banco (`SELECT 1`) e responde 503 quando ele está fora; a imagem Docker usa isso no `HEALTHCHECK`.

### Siglas no app
Toda sigla aparece com o significado onde é exibida (ex.: "esforço 8/10 (RPE)", "1RM (carga máxima para 1 repetição)"), e Perfil tem um **glossário** completo (`mobile/src/engine/glossary.ts`).

## Backend

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/pytest                                   # 259 testes (SQLite)
KNIGHTFALL_TEST_DATABASE_URL=postgresql+psycopg://... .venv/bin/pytest   # os mesmos, num Postgres
.venv/bin/ruff check knightfall tests
.venv/bin/uvicorn knightfall.api:app --reload --host 0.0.0.0
```

- **Banco:** SQLite (`knightfall.db`) por padrão. As migrações rodam sozinhas no startup; para rodar à mão: `alembic -c alembic.ini upgrade head`.
- **Produção com Postgres + TimescaleDB:** `POSTGRES_PASSWORD=... docker compose up --build`. A imagem é multi-stage, roda como usuário sem privilégios (uid 10001) e, sem `KNIGHTFALL_DATABASE_URL`, usa SQLite em `/data`. O CI constrói a imagem e confere o `/health`.
- **Índices:** séries e alimentos têm índice composto (atleta, dia) — migração 0006. Um teste compara as migrações com os modelos, então um modelo alterado sem migração falha no CI.
- **Docs interativas:** `http://localhost:8000/docs`.

## Mobile

O app usa módulos nativos (BLE, HealthKit, Health Connect, câmera), então **não roda no Expo Go**.
É preciso um development build:

```bash
cd mobile
npm install
EXPO_PUBLIC_API_URL=http://<ip-da-máquina>:8000 npx expo run:android   # ou run:ios (macOS + Xcode)
npm test                                                                # 68 testes da lógica pura
npm run typecheck
npm run lint
```

- **Requisitos de plataforma:** Android minSdk 26 (exigido pelo Health Connect). No iOS, HealthKit e BLE só funcionam em aparelho físico.
- **Sons:** `npm run gen:sounds` recria os sons (metrônomo e alarme).
- **Tipos da API:** gerados do OpenAPI do backend, nunca escritos à mão. Depois de mudar um modelo do backend:
  `cd backend && .venv/bin/python -m knightfall.openapi > ../mobile/src/api/openapi.json && cd ../mobile && npm run gen:api`.
  O CI falha se o schema ou os tipos estiverem desatualizados.
- **Demonstração dos exercícios:** "Como fazer" abre, dentro do app e sem internet, as fotos de início e fim do movimento alternando como um GIF (137 dos 160 exercícios), com as dicas da prescrição; os cards do treino mostram a miniatura. As fotos vêm do [free-exercise-db](https://github.com/yuhonas/free-exercise-db) (domínio público, The Unlicense), redimensionadas para WebP de 600 px (~4 MB no total): `npm run gen:media` refaz tudo a partir do mapeamento em `scripts/gen_exercise_media.py`. Os 23 exercícios sem foto (mobilidade e alguns funcionais) têm passo a passo escrito em `src/engine/howTo.ts`. Um teste do backend falha se algum exercício do catálogo ficar sem demonstração.

## O que não está feito / não foi verificado

- **App nativo de Apple Watch:** o háptico do metrônomo está no celular. Um app watchOS é um projeto Swift separado.
- **API direta da Garmin:** a Garmin Health API exige parceria comercial; o caminho usado é Garmin → Apple Health / Health Connect.
- **Machine Learning no Chaos Engine:** a autorregulação é por modelo (e1RM + tabela RPE), não por ML treinado.
- **Não testado em hardware:** BLE, HealthKit, Health Connect, notificações e câmera estão tipados, compilam e passam no `expo prebuild`, mas não rodaram em aparelho.
- **Postgres:** a suíte inteira roda contra PostgreSQL 16 (verificado localmente; o CI usa a imagem TimescaleDB, que também exercita o hypertable e a compressão). Docker não foi executado localmente: o job `docker` do CI é quem constrói e sobe a imagem. As mudanças de 2026-10-18 (`ON CONFLICT`, migração 0006) passaram na suíte SQLite; contra Postgres só rodam no CI.
- **Conta:** faltam recuperação de senha e verificação de e-mail. O cadastro responde 409 para e-mail já usado, o que revela que a conta existe; fechar isso exige confirmação por e-mail.
