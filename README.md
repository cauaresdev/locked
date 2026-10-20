# Project Knightfall

Implementação do protocolo **Joint-Friendly Heavy Chaos** (preparação BvS) + dieta
**Six Pack Diet Plan (Rehan Jalali)**, com integração de wearables.

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
| Tiers | `tiers.py` | Vigilante 45 min ×0,5 séries · Dark Knight 60 min ×0,75 · Brawler integral, com termo e aviso após 16 semanas. |
| Metrônomo | `mobile/src/engine/tempo.ts`, `hooks/useMetronome.ts` | Bipe + háptico por segundo, bipe forte na troca de fase. |
| Autorregulação de carga | `strength.py`, `progression.py` | 1RM estimado (carga máxima para 1 repetição) pela tabela de RPE (esforço percebido) por repetições em reserva → carga para as repetições e o esforço alvo. Só séries retas de força/hipertrofia estimam o 1RM (tempo, explosivo e isométrico ficam de fora; a série registra a modalidade), usando os 3 últimos dias do exercício dentro de 60 dias. Trabalho explosivo é prescrito a 65% do 1RM. Em exercícios com peso corporal, o peso entra na massa total. Fallback por esforço para carregamentos/trenó: sobe pelo menos um incremento; se passou do esforço, desce ~5% arredondado ao incremento mais próximo (com kettlebell, 4 kg costuma ser demais, então a carga se mantém). No app, o esforço **não vem preenchido**: é um seletor obrigatório de 6 a 10. |
| Batsuit Readiness | `readiness.py` | VFC (variabilidade da frequência cardíaca): média de 7 dias de ln(VFC) vs. linha de base de 60 dias, alerta abaixo de 0,5 desvio padrão (Plews/Buchheit); antes de 14 leituras, compara com a semana anterior. Mesmo método sempre (SDNN ≠ RMSSD). Mais sono e dor. O ACWR (razão de carga aguda:crônica) de lombar e ombro não entra na nota: acima de 1,5 só rebaixa um dia verde para amarelo, nunca força vermelho, e só existe com 21+ dias de histórico de treino (a média crônica cobre os dias desde o primeiro treino registrado, até 28). Antes de 14 leituras, uma VFC até 5% abaixo da semana anterior conta como normal. Vermelho → Bloco 1 expandido (Brawler 32 → 45 min, Dark Knight 16 → 24, Vigilante 12 → 18). |
| Armor Load | `armor.py` | Capacidade de Carga Operacional (kg·m, quilos × metros): carregamentos, trenó e barra fixa (peso corporal + lastro, se houver; sem lastro também conta, porque o corpo é a carga). |
| Deload | `generator.py`, `tiers.py`, `services.py` | Semana de descarga a cada 5 ciclos no Brawler e 6 nos outros, ou após 3 dias seguidos de prontidão vermelha — nesse caso vale por um ciclo inteiro (8 ou 7 dias) a partir do terceiro dia, derivado do histórico de prontidão: séries do Bloco 2 ×0,6 e esforço alvo −2. |
| Equipamentos | `chaos.py` | Perfil do que a academia tem; o sorteio só usa esses implementos (peso corporal sempre). Quando o perfil deixa um padrão sem opção, entram substitutos com peso corporal (caminhada/trote, flexão pike, agachamento livre, hip thrust unilateral, bear crawl, mountain climber…); se nem assim houver (rolo de liberação), o exercício entra e a sessão avisa qual implemento falta. Na sessão, "Trocar exercício" lista alternativas do mesmo padrão de movimento, substitutos inclusos (`/sessions/{dia}/alternatives`). |
| Treino perdido | `routes_training.py` | `/cycle/missed` detecta dias de treino sem séries; "Repor hoje" empurra o ciclo (`/cycle/shift`) para fazer o treino perdido. |
| Desfazer série | `mobile/src/storage/db.ts`, `DELETE /logs/{id}` | Tira da fila offline se ainda não subiu; senão enfileira a exclusão no servidor. |
| Progresso | `routes_progress.py`, aba Progresso | Gráficos de 1RM estimado por exercício, peso (pesagens + média de 7 dias), prontidão, sono, VFC, carga por ciclo, calorias e proteína vs. meta, frequência. Cada gráfico tem visão em tabela. |

### Nutrição (`knightfall/nutrition.py`, `foods.py`)
- **Calorias:** 12 kcal/lb de massa magra + gasto do treino do dia, com teto de 14 kcal/lb.
  - O gasto vem da frequência cardíaca medida (fórmula de Keytel) fora do bloco de força; **dentro** dele (janela pelo horário das séries) usa MET 5 (equivalente metabólico), porque a FC na musculação sobe sem consumo de oxigênio proporcional e Keytel superestima. Sem cinta, estimativa por MET do treino planejado.
  - Sempre gasto **líquido**: o repouso (1 MET) já está nas 12 kcal/lb, então é descontado, e amostras abaixo de 50% da FC máx. (90 bpm sem FC máx.) não contam.
- **Peso:** pesagens diárias (manuais ou da balança via Apple Health / Health Connect); a **média de 7 dias** vira o peso usado em todas as metas.
- **Massa magra:** calculada pelo % de gordura; sem ele, pela fórmula de Boer (altura e sexo), limitada a 50–95% do peso; sem nenhum dos dois, assumida e sinalizada no app.
- **Carb curfew:** carboidratos só no café e no pós-treino. Lanche e jantar ficam com meta de 0 g. Vegetais fibrosos (categoria "vegetal": crucíferos como brócolis e couve-de-bruxelas, e folhas como espinafre) não contam no alerta; o resto tolera 10 g. A regra usa a categoria, e não só crucíferos, porque alimentos escaneados ou digitados trazem a categoria, não a família botânica.
- **Laticínios:** usa principalmente o alérgeno `en:milk` do Open Food Facts e, nos ingredientes, palavras inteiras em inglês, português, espanhol e francês (whey, caseína, queijo, manteiga, nata, requeijão, fromage, leche…). Ignora falsos positivos como leite de coco, manteiga de cacau/amendoim, tofu (bean curd) e cremor tártaro. Whey isolado hidrolisado é a única exceção permitida: precisa de um ingrediente que seja whey isolado **e** hidrolisado, e nenhum outro laticínio (um blend com concentrado continua "contém").
- **Sódio:** teto de 1.500–2.000 mg/dia. Alerta vermelho quando uma refeição passa de 500 mg, já calculado no scanner considerando o que a refeição já tem.
- **Suplementos:** checklist com óleo de linhaça 2×, CLA (ácido linoleico conjugado) nas refeições e whey isolado com água.
- **Divisão de macros:** proteína 1,1 g/lb de massa magra e gordura ≥ 25%. **Essa divisão é escolha do app, não do protocolo.**

### Wearables e telemetria
- **Cinta cardíaca e bike** (`mobile/src/ble`, via `react-native-ble-manager`):
  - Heart Rate Service 0x180D, FTMS Indoor Bike 0x2AD2 e Cycling Power 0x2A63.
  - Reconecta sozinho e grava amostras a 1 Hz numa fila offline.
- **Apple Health / Health Connect** (`mobile/src/health`): VFC, FC de repouso e sono da última noite alimentam o Readiness.
  - Garmin, Oura e Whoop entram pela sincronização do app do fabricante com o Health / Health Connect.
- **Telemetria:** tabela `telemetry_samples`, que vira hypertable TimescaleDB quando o Postgres tem a extensão (migração 0002) e é comprimida depois de 7 dias (migração 0004). Na mesma rota ficam o resumo por zona, as kcal e a potência.

### Gotham Early Bird (`knightfall/early_bird.py`)
- Alarme diário via notificação local, com som próprio e canal Android de importância máxima.
- O check-in "acordei" abre uma janela de 30 min. Dentro dela é preciso acumular 20 min com FC entre 70% e 80% da FC máx. (alvo de ~75%), medida pela cinta.
- O servidor valida a janela e calcula a sequência de dias cumpridos (uma janela de hoje que fechou sem os 20 min zera a sequência na hora).
- No app, a voz avisa quando você entra, sai acima ou fica abaixo da zona.

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
- **Portabilidade:** `GET /auth/export` devolve tudo em JSON, transmitido tabela a tabela (a memória do servidor não cresce com meses de telemetria); no app, Ajustes › Exportar meus dados gera um arquivo para compartilhar.
- **Exclusão:** `DELETE /auth/account` (com a senha) apaga a conta e todos os registros; no app, Ajustes › Excluir minha conta.

### Observabilidade
- Um log JSON por requisição (método, rota-modelo sem IDs, status, duração, `x-request-id`). Corpos nunca entram no log — carregam dados de saúde. Nível em `KNIGHTFALL_LOG_LEVEL`.
- Erros não tratados vão para o Sentry quando `SENTRY_DSN` está definido (extra `observability`, já incluso na imagem Docker). Sem corpo de requisição, sem variáveis locais, sem query string e só cabeçalhos inofensivos; o SQLAlchemy roda com `hide_parameters`, então os valores de um comando que falhou também não aparecem nas mensagens de erro.
- Um `x-request-id` enviado pelo cliente só é reaproveitado se for curto e opaco (`[A-Za-z0-9_.-]{1,64}`).
- `GET /health` testa o banco (`SELECT 1`) e responde 503 quando ele está fora; a imagem Docker usa isso no `HEALTHCHECK`.

### Siglas no app
Toda sigla aparece com o significado onde é exibida (ex.: "esforço 8/10 (RPE)", "1RM (carga máxima para 1 repetição)"), e Ajustes tem um **glossário** completo (`mobile/src/engine/glossary.ts`).

## Backend

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/pytest                                   # 153 testes (SQLite)
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
npm test                                                                # 57 testes da lógica pura
npm run typecheck
npm run lint
```

- **Requisitos de plataforma:** Android minSdk 26 (exigido pelo Health Connect). No iOS, HealthKit e BLE só funcionam em aparelho físico.
- **Sons:** `npm run gen:sounds` recria os sons (metrônomo e alarme).
- **Tipos da API:** gerados do OpenAPI do backend, nunca escritos à mão. Depois de mudar um modelo do backend:
  `cd backend && .venv/bin/python -m knightfall.openapi > ../mobile/src/api/openapi.json && cd ../mobile && npm run gen:api`.
  O CI falha se o schema ou os tipos estiverem desatualizados.
- **Demonstração dos exercícios:** "Como fazer ▸" abre uma busca de vídeo pelo nome do exercício; não há vídeos próprios nem curados.

## O que não está feito / não foi verificado

- **App nativo de Apple Watch:** o háptico do metrônomo está no celular. Um app watchOS é um projeto Swift separado.
- **API direta da Garmin:** a Garmin Health API exige parceria comercial; o caminho usado é Garmin → Apple Health / Health Connect.
- **Machine Learning no Chaos Engine:** a autorregulação é por modelo (e1RM + tabela RPE), não por ML treinado.
- **Não testado em hardware:** BLE, HealthKit, Health Connect, notificações e câmera estão tipados, compilam e passam no `expo prebuild`, mas não rodaram em aparelho.
- **Postgres:** a suíte inteira roda contra PostgreSQL 16 (verificado localmente; o CI usa a imagem TimescaleDB, que também exercita o hypertable e a compressão). Docker não foi executado localmente: o job `docker` do CI é quem constrói e sobe a imagem. As mudanças de 2026-10-18 (`ON CONFLICT`, migração 0006) passaram na suíte SQLite; contra Postgres só rodam no CI.
- **Conta:** faltam recuperação de senha e verificação de e-mail. O cadastro responde 409 para e-mail já usado, o que revela que a conta existe; fechar isso exige confirmação por e-mail.
