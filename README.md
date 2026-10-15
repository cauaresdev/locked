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
| Chaos Engine | `chaos.py`, `templates.py`, `catalog.py` | Padrão fixo por slot; a cada ciclo troca exercício **e** implemento ou modalidade. Determinístico por seed. |
| Tiers | `tiers.py` | Vigilante 45 min ×0,5 séries · Dark Knight 60 min ×0,75 · Brawler integral, com termo e aviso após 16 semanas. |
| Metrônomo | `mobile/src/engine/tempo.ts`, `hooks/useMetronome.ts` | Bipe + háptico por segundo, bipe forte na troca de fase. |
| Autorregulação de carga | `strength.py`, `progression.py` | e1RM pela tabela RPE/reps-em-reserva → carga para reps@RPE alvo. Em exercícios com peso corporal, o peso entra na massa total. Fallback por RPE para carries/trenó. |
| Batsuit Readiness | `readiness.py` | VFC vs. linha de base (mesmo método: SDNN ≠ RMSSD), sono, dor, ACWR lombar/ombro. Vermelho → Bloco 1 vai a 45 min. |
| Armor Load | `armor.py` | Capacidade de Carga Operacional (kg·m): carries, trenó, barra com lastro. |

### Nutrição (`knightfall/nutrition.py`, `foods.py`)
- **Calorias:** 12 kcal/lb de massa magra + gasto do treino do dia, com teto de 14 kcal/lb.
  - O gasto vem da FC medida (fórmula de Keytel) ou, sem cinta, de uma estimativa por MET do treino planejado.
- **Massa magra:** calculada pelo % de gordura; sem ele, pela fórmula de Boer (altura e sexo); sem nenhum dos dois, assumida e sinalizada no app.
- **Carb curfew:** carboidratos só no café e no pós-treino. Lanche e jantar ficam com meta de 0 g, e vegetais crucíferos não contam no alerta.
- **Laticínios:** usa os alérgenos e ingredientes do Open Food Facts (whey, caseína, lactose…) e ignora falsos positivos como leite de coco e manteiga de cacau. Whey isolado hidrolisado é a única exceção permitida.
- **Sódio:** teto de 1.500–2.000 mg/dia. Alerta vermelho quando uma refeição passa de 500 mg, já calculado no scanner considerando o que a refeição já tem.
- **Suplementos:** checklist com óleo de linhaça 2×, CLA nas refeições e whey isolado com água.
- **Divisão de macros:** proteína 1,1 g/lb de massa magra e gordura ≥ 25%. **Essa divisão é escolha do app, não do protocolo.**

### Wearables e telemetria
- **Cinta cardíaca e bike** (`mobile/src/ble`, via `react-native-ble-manager`):
  - Heart Rate Service 0x180D, FTMS Indoor Bike 0x2AD2 e Cycling Power 0x2A63.
  - Reconecta sozinho e grava amostras a 1 Hz numa fila offline.
- **Apple Health / Health Connect** (`mobile/src/health`): VFC, FC de repouso e sono da última noite alimentam o Readiness.
  - Garmin, Oura e Whoop entram pela sincronização do app do fabricante com o Health / Health Connect.
- **Telemetria:** tabela `telemetry_samples`, que vira hypertable TimescaleDB quando o Postgres tem a extensão (migração 0002). Na mesma rota ficam o resumo por zona, as kcal e a potência.

### Gotham Early Bird (`knightfall/early_bird.py`)
- Alarme diário via notificação local, com som próprio e canal Android de importância máxima.
- O check-in "acordei" abre uma janela de 30 min. Dentro dela é preciso acumular 20 min com FC entre 70% e 80% da FC máx. (alvo de ~75%), medida pela cinta.
- O servidor valida a janela e calcula a sequência de dias cumpridos.
- No app, a voz avisa quando você entra, sai acima ou fica abaixo da zona.

### Conta e segurança
- **Login:** e-mail e senha (hash scrypt, sem dependências extras). O token opaco é guardado só como hash, vale 90 dias e o logout o revoga.
- **Isolamento entre usuários:** cada usuário acessa apenas o próprio atleta; o atleta de outra pessoa responde 404.
- **Limite de tentativas:** 5 logins errados por e-mail e 30 por IP a cada 15 min (429 com `Retry-After`). O contador fica em memória, por processo.
- **E-mail inexistente:** o login faz o mesmo trabalho de scrypt e devolve a mesma resposta, então o tempo não revela quais e-mails têm conta.
- **CORS:** desligado por padrão (o app nativo não precisa). Para um cliente web, liste as origens em `KNIGHTFALL_CORS_ORIGINS`.
- **No app:** o token fica no Secure Store. Um 401 volta para o login **sem apagar** a fila offline, que sobe quando o mesmo usuário entra de novo. Os dados locais só são apagados quando outra conta entra, ou no "Sair" (que tenta sincronizar antes e avisa se algo ficaria para trás).
- **Sincronização:** quando o servidor recusa um lote (400/413/422), o app divide o lote até isolar os itens inválidos. Esses itens vão para uma tabela de recusados ("N recusados" na tela Hoje) e o resto da fila segue.

## Backend

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/pytest                                   # 55 testes
.venv/bin/ruff check knightfall tests
.venv/bin/uvicorn knightfall.api:app --reload --host 0.0.0.0
```

- **Banco:** SQLite (`knightfall.db`) por padrão. As migrações rodam sozinhas no startup; para rodar à mão: `alembic -c alembic.ini upgrade head`.
- **Produção com Postgres + TimescaleDB:** `POSTGRES_PASSWORD=... docker compose up --build`.
- **Docs interativas:** `http://localhost:8000/docs`.

## Mobile

O app usa módulos nativos (BLE, HealthKit, Health Connect, câmera), então **não roda no Expo Go**.
É preciso um development build:

```bash
cd mobile
npm install
EXPO_PUBLIC_API_URL=http://<ip-da-máquina>:8000 npx expo run:android   # ou run:ios (macOS + Xcode)
npm test                                                                # 28 testes da lógica pura
npm run typecheck
npm run lint
```

- **Requisitos de plataforma:** Android minSdk 26 (exigido pelo Health Connect). No iOS, HealthKit e BLE só funcionam em aparelho físico.
- **Sons:** `npm run gen:sounds` recria os sons (metrônomo e alarme).

## O que não está feito / não foi verificado

- **App nativo de Apple Watch:** o háptico do metrônomo está no celular. Um app watchOS é um projeto Swift separado.
- **API direta da Garmin:** a Garmin Health API exige parceria comercial; o caminho usado é Garmin → Apple Health / Health Connect.
- **Machine Learning no Chaos Engine:** a autorregulação é por modelo (e1RM + tabela RPE), não por ML treinado.
- **Não testado em hardware:** BLE, HealthKit, Health Connect, notificações e câmera estão tipados, compilam e passam no `expo prebuild`, mas não rodaram em aparelho.
- **Não testado num Postgres real:** só a geração do SQL das migrações foi verificada; TimescaleDB e Docker não foram executados.
- **Conta:** faltam recuperação de senha e verificação de e-mail. O cadastro responde 409 para e-mail já usado, o que revela que a conta existe; fechar isso exige confirmação por e-mail.
- **Advisory lock das migrações no Postgres:** escrito, mas não executado (sem Postgres aqui).
