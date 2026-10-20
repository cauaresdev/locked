import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Storage from 'expo-sqlite/kv-store';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import type { Block, Prescription, Session, SetLog } from '../../api/types';
import { SetRunner, type SetResult } from '../../components/SetRunner';
import { LiveHr } from '../../components/LiveHr';
import { TimerButton } from '../../components/TimerButton';
import { fresh, useLiveBike } from '../../ble/devices';
import { Badge, Button, Panel, Row, T, TextLink } from '../../components/ui';
import { clock, repsToLog, rxSummary } from '../../engine/format';
import {
  applySwaps,
  blockComplete,
  blockLocked,
  itemKey,
  sessionComplete,
  withLastSetUndone,
  withSetLogged,
  type Progress,
} from '../../engine/progress';
import { useComms } from '../../hooks/useComms';
import { useCountdown } from '../../hooks/useCountdown';
import { useCues } from '../../hooks/useCues';
import { api } from '../../api/client';
import { openExactAlarmSettings, prepareRestAlerts, scheduleRestAlert } from '../../notifications';
import { cachedSession, enqueueLogs, loadProgress, saveProgress, storedAthlete, undoLog } from '../../storage/db';
import { flushAll, loadSession } from '../../sync';
import { colors, space } from '../../theme';

const EXACT_ALARM_ASKED_KEY = 'knightfall_exact_alarm_asked'; // once: Ajustes keeps the switch afterwards

const BLOCK_CALLOUT: Record<string, string> = {
  prep: 'Bloco um. Preparação de tecido e movimento.',
  strength: 'Bloco dois liberado. Torso e força bruta.',
  conditioning: 'Bloco três. Máximo de rodadas.',
};

function makeLog(day: string, rx: Prescription, setIndex: number, r: Partial<SetResult>): SetLog {
  return {
    id: Crypto.randomUUID(),
    performed_on: day,
    exercise_id: rx.exercise_id,
    modality: rx.modality, // only straight strength sets feed the 1RM estimate
    set_index: setIndex,
    reps: r.reps ?? null,
    load_kg: r.load_kg ?? null,
    duration_seconds: r.duration_seconds ?? null,
    rpe: r.rpe ?? null,
    performed_at: new Date().toISOString(), // dates the strength block for the energy estimate
  };
}

/** A video search for the exercise: the catalog has cues but no demonstrations of its own. */
function DemoLink({ name }: { name: string }) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${name} exercise technique`)}`;
  return (
    <TextLink label="Como fazer ▸" role="link" accessibilityLabel={`Como fazer: ${name}, vídeo no YouTube`}
      onPress={() => Linking.openURL(url).catch(() => {})} />
  );
}

export default function SessionScreen() {
  useKeepAwake();
  const router = useRouter();
  const { day } = useLocalSearchParams<{ day: string }>();
  const athleteId = storedAthlete()?.id;
  const comms = useComms();
  const play = useCues();
  const [session, setSession] = useState<Session | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [lastLoad, setLastLoad] = useState<Record<string, number>>({});
  const [restFor, setRestFor] = useState<{ id: number; seconds: number; next: string; upNext: UpNext | null } | null>(
    null,
  );
  const [swapFor, setSwapFor] = useState<SwapTarget | null>(null);
  // Latest progress, so handlers that await storage never write from a stale snapshot.
  const progressRef = useRef<Progress | null>(null);
  // One write at a time: a double tap on "Registrar série", "+1 rodada" or "Desfazer" must not
  // read the same set index twice before the first write lands.
  const writing = useRef(false);
  const exclusive = useCallback(async (fn: () => Promise<void>) => {
    if (writing.current) return;
    writing.current = true;
    try {
      await fn();
    } catch {
      Alert.alert('Não foi possível salvar', 'A série não foi registrada no aparelho. Tente de novo.');
    } finally {
      writing.current = false;
    }
  }, []);

  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    prepareRestAlerts()
      .then((late) => {
        if (!late || Storage.getItemSync(EXACT_ALARM_ASKED_KEY)) return;
        Storage.setItemSync(EXACT_ALARM_ASKED_KEY, '1');
        Alert.alert(
          'Aviso de descanso na hora certa',
          'Com a tela travada, o Android pode atrasar o aviso de fim do descanso em quase todo o tempo do ' +
            'descanso. Ative “Alarmes e lembretes” para o Knightfall e ele toca no segundo exato.',
          [{ text: 'Agora não', style: 'cancel' }, { text: 'Ativar', onPress: openExactAlarmSettings }],
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const cached = await cachedSession(day);
        const s = cached ?? (athleteId ? (await loadSession(athleteId, day)).session : null);
        if (!s) throw new Error('no session');
        setSession(s);
        const p = await loadProgress(day);
        progressRef.current = p;
        setProgress(p);
      } catch {
        setLoadError('Sem conexão e sem esta sessão em cache. Abra o app com sinal para baixar a programação.');
      }
    })();
  }, [day, athleteId]);

  const update = useCallback(
    (fn: (p: Progress) => Progress) => {
      const prev = progressRef.current;
      if (!prev || !session) return;
      const next = fn({ ...prev, startedAt: prev.startedAt ?? Date.now() });
      // Announce the block this change unlocks.
      const before = applySwaps(session, prev);
      const after = applySwaps(session, next);
      const unlocked = after.blocks.find(
        (b) => blockLocked(before, b.order, prev) && !blockLocked(after, b.order, next),
      );
      if (unlocked) {
        comms.say(BLOCK_CALLOUT[unlocked.kind] ?? unlocked.name);
        play('phase');
      }
      if (!next.finishedAt && sessionComplete(after, next)) {
        next.finishedAt = Date.now();
        comms.say('Sessão concluída. Desligando.');
        if (athleteId) flushAll(athleteId).catch(() => {}); // stays queued for the next sync
      }
      progressRef.current = next;
      setProgress(next);
      saveProgress(day, next).catch(() =>
        Alert.alert('Não foi possível salvar', 'O progresso da sessão não foi gravado no aparelho.'),
      );
    },
    [session, comms, play, day, athleteId],
  );

  if (!session || !progress) {
    return (
      <SafeAreaView style={styles.root}>
        {loadError ? (
          <View style={{ padding: space.lg, gap: space.lg }}>
            <T color={colors.amber}>{loadError}</T>
            <Button label="Voltar" onPress={() => router.back()} />
          </View>
        ) : (
          <T variant="label" style={{ padding: space.lg }}>Carregando sessão…</T>
        )}
      </SafeAreaView>
    );
  }

  const view = applySwaps(session, progress);
  const done = sessionComplete(view, progress);

  const logSet = (block: Block, index: number, rx: Prescription, r: SetResult) =>
    exclusive(async () => {
      const key = itemKey(block.order, index);
      const setIndex = progressRef.current?.setsDone[key] ?? 0;
      if (setIndex >= rx.sets) return;
      const entry = makeLog(day, rx, setIndex, r);
      await enqueueLogs([entry]);
      if (r.load_kg != null) setLastLoad((m) => ({ ...m, [rx.exercise_id]: r.load_kg as number }));
      update((p) => withSetLogged(p, key, entry.id));
      Haptics.selectionAsync().catch(() => {});
      const finished = setIndex + 1 >= rx.sets;
      if (finished) setActive(null);
      const rest = Math.min(block.rest_seconds, session.rest_cap_seconds);
      if (rest > 0) {
        const next = finished ? 'Próximo exercício.' : `Série ${setIndex + 2}. Executar.`;
        // What comes after the rest: this lift's next set, or the next lift of the block if it has sets left.
        const nextRx = finished ? block.exercises[index + 1] : rx;
        const nextSet = finished ? (progressRef.current?.setsDone[itemKey(block.order, index + 1)] ?? 0) + 1 : setIndex + 2;
        const upNext =
          nextRx && nextSet <= nextRx.sets
            ? upNextOf(nextRx, nextSet, finished ? (lastLoad[nextRx.exercise_id] ?? nextRx.suggested_load_kg) : r.load_kg)
            : null;
        comms.say(`Descanso. ${rest} segundos.`);
        setRestFor((prev) => ({ id: (prev?.id ?? 0) + 1, seconds: rest, next, upNext }));
      }
    });

  const undoSet = (key: string) =>
    exclusive(async () => {
      const current = progressRef.current;
      if (!current) return;
      const { progress: undone, logId } = withLastSetUndone(current, key);
      if (undone === current) return; // nothing left to undo
      if (logId) await undoLog(logId);
      update(() => undone);
      Haptics.selectionAsync().catch(() => {});
      setRestFor(null);
      comms.say('Série desfeita.');
    });

  const amrapRound = (block: Block) =>
    exclusive(async () => {
      const round = progressRef.current?.amrapRounds[block.order] ?? 0;
      await enqueueLogs(
        block.exercises.map((rx) =>
          makeLog(day, rx, round, {
            reps: rx.mode === 'reps' ? repsToLog(rx) : null,
            duration_seconds: rx.mode === 'reps' ? null : rx.duration_seconds,
            load_kg: lastLoad[rx.exercise_id] ?? rx.suggested_load_kg,
          }),
        ),
      );
      update((p) => ({ ...p, amrapRounds: { ...p.amrapRounds, [block.order]: round + 1 } }));
      comms.say(`Rodada ${round + 1}.`);
    });

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Sair da sessão"
          hitSlop={14}>
          <T variant="label">◂ Sair</T>
        </Pressable>
        <Row>
          <Elapsed startedAt={progress.startedAt} finishedAt={progress.finishedAt} />
          <LiveHr />
        </Row>
        <Pressable onPress={comms.toggle} accessibilityRole="switch" accessibilityLabel="Comandos de voz"
          accessibilityState={{ checked: !comms.muted }} hitSlop={14}>
          <T variant="label" color={comms.muted ? colors.amber : colors.concrete}>
            {comms.muted ? 'Voz desligada' : 'Voz ligada'}
          </T>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
      >
        <T variant="title">{session.day_name}</T>
        {done && (
          <Panel accent={colors.kryptonite}>
            <T variant="title" color={colors.kryptonite}>Sessão concluída</T>
            <T color={colors.concrete}>
              {clock(((progress.finishedAt ?? 0) - (progress.startedAt ?? 0)) / 1000)} · séries
              registradas e enviadas quando houver sinal.
            </T>
          </Panel>
        )}

        {view.deload && (
          <Badge label="Deload · semana de descarga" color={colors.amber} />
        )}
        {view.notices.map((n) => (
          <T key={n} variant="hint" color={colors.amber}>▸ {n}</T>
        ))}

        {view.blocks.map((block) => {
          const locked = blockLocked(view, block.order, progress);
          const complete = blockComplete(view, block.order, progress);
          return (
            <View key={block.order} style={{ gap: space.sm }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <T variant="label" color={complete ? colors.kryptonite : colors.concrete}>
                  Bloco {block.order} · {block.duration_minutes} min
                </T>
                {locked && <Badge label="Bloqueado" color={colors.amber} />}
                {complete && <Badge label="Concluído" color={colors.kryptonite} />}
              </Row>
              <T style={{ fontSize: 16 }}>{block.name}</T>
              {locked ? (
                <Panel accent={colors.amber}>
                  <T color={colors.amber}>
                    Conclua a preparação articular antes da carga. Sem Bloco 1, sem Bloco {block.order}.
                  </T>
                </Panel>
              ) : block.execution_style === 'checklist' ? (
                block.exercises.map((rx, i) => {
                  const key = itemKey(block.order, i);
                  const checked = !!progress.checked[key];
                  const toggle = (value: boolean) =>
                    update((p) => ({ ...p, checked: { ...p.checked, [key]: value } }));
                  return (
                    <Panel key={key} accent={checked ? colors.kryptonite : undefined}>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Pressable style={styles.target}
                          onPress={() => {
                            Haptics.selectionAsync().catch(() => {});
                            toggle(!checked);
                          }}
                          accessibilityRole="checkbox" accessibilityState={{ checked }}>
                          <T color={checked ? colors.kryptonite : colors.bone}>{rx.name}</T>
                          <T variant="hint">{rxSummary(rx)}</T>
                        </Pressable>
                        {rx.mode === 'timed' && rx.duration_seconds && !checked && (
                          <TimerButton seconds={rx.duration_seconds} onDone={() => toggle(true)} />
                        )}
                      </Row>
                      {/* A sibling, not inside the checkbox: links never nest in another control. */}
                      <DemoLink name={rx.name} />
                    </Panel>
                  );
                })
              ) : block.execution_style === 'straight_sets' ? (
                block.exercises.map((rx, i) => {
                  const key = itemKey(block.order, i);
                  const doneSets = progress.setsDone[key] ?? 0;
                  const finished = doneSets >= rx.sets;
                  const isActive = active === key;
                  return (
                    <View key={key} style={{ gap: space.xs }}>
                      <Panel accent={finished ? colors.kryptonite : isActive ? colors.bone : undefined}>
                        {/* Only the header toggles the set runner; the links below are its siblings. */}
                        <Pressable onPress={() => setActive(isActive ? null : key)} accessibilityRole="button"
                          accessibilityLabel={`${rx.name}, ${doneSets} de ${rx.sets} séries`}
                          accessibilityState={{ expanded: isActive && !finished }}
                          style={styles.setHeader}>
                          <Row style={{ justifyContent: 'space-between' }}>
                            <T color={finished ? colors.kryptonite : colors.bone} style={{ flex: 1 }}>{rx.name}</T>
                            <SetDots done={doneSets} total={rx.sets} />
                          </Row>
                          <T variant="hint">{rxSummary(rx)}</T>
                        </Pressable>
                        <Row style={{ gap: space.lg }}>
                          <DemoLink name={rx.name} />
                          {doneSets === 0 && athleteId && (
                            <TextLink label="Trocar exercício ▸" accessibilityLabel={`Trocar ${rx.name}`}
                              onPress={() => setSwapFor({ key, block: block.order, index: i })} />
                          )}
                          {doneSets > 0 && (
                            <TextLink label="Desfazer última série" color={colors.amber}
                              accessibilityLabel={`Desfazer última série de ${rx.name}`} onPress={() => undoSet(key)} />
                          )}
                        </Row>
                      </Panel>
                      {isActive && !finished && (
                        <SetRunner
                          key={`${key}:${doneSets}`}
                          rx={rx}
                          setNumber={doneSets + 1}
                          defaultLoad={lastLoad[rx.exercise_id] ?? rx.suggested_load_kg}
                          onLog={(r) => logSet(block, i, rx, r)}
                        />
                      )}
                    </View>
                  );
                })
              ) : (
                <Amrap
                  block={block}
                  restSeconds={Math.min(block.rest_seconds, session.rest_cap_seconds)}
                  onSwap={athleteId ? (i) => setSwapFor({ key: itemKey(block.order, i), block: block.order, index: i }) : undefined}
                  rounds={progress.amrapRounds[block.order] ?? 0}
                  endsAt={progress.amrapEndsAt?.[block.order] ?? null}
                  done={blockComplete(view, block.order, progress)}
                  onRound={() => amrapRound(block)}
                  onStart={() => {
                    const endsAt = Date.now() + block.duration_minutes * 60_000;
                    update((p) => ({ ...p, amrapEndsAt: { ...p.amrapEndsAt, [block.order]: endsAt } }));
                    comms.say(`Máximo de rodadas em ${block.duration_minutes} minutos. Executar.`);
                  }}
                  onEnd={(early) => {
                    update((p) => ({ ...p, amrapDone: { ...p.amrapDone, [block.order]: true } }));
                    comms.say(early ? 'Bloco de rodadas encerrado.' : 'Tempo. Bloco de rodadas encerrado.');
                  }}
                />
              )}
            </View>
          );
        })}
      </ScrollView>

      {swapFor && athleteId && (
        <SwapSheet
          athleteId={athleteId}
          day={day}
          target={swapFor}
          current={view.blocks.find((b) => b.order === swapFor.block)?.exercises[swapFor.index] ?? null}
          onPick={(rx) => {
            update((p) => ({ ...p, swaps: { ...p.swaps, [swapFor.key]: rx } }));
            setSwapFor(null);
          }}
          onClose={() => setSwapFor(null)}
        />
      )}

      {restFor && (
        <Rest
          key={restFor.id}
          seconds={restFor.seconds}
          next={restFor.next}
          upNext={restFor.upNext}
          onDone={(late) => {
            if (!late) comms.say(restFor.next); // late: the notification already called it
            setRestFor(null);
          }}
          onSkip={() => setRestFor(null)}
        />
      )}
    </SafeAreaView>
  );
}

/** One square per set, filled as sets are logged: readable from arm's length, unlike "2/4". */
function SetDots({ done, total }: { done: number; total: number }) {
  return (
    <Row style={{ gap: 3 }}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[styles.dot, i < done && { backgroundColor: colors.kryptonite, borderColor: colors.kryptonite }]} />
      ))}
    </Row>
  );
}

/** Session clock, ticking on its own so the rest of the screen doesn't re-render every second. */
function Elapsed({ startedAt, finishedAt }: { startedAt: number | null; finishedAt: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  const ticking = startedAt != null && finishedAt == null;
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);
  const elapsed = startedAt ? ((finishedAt ?? now) - startedAt) / 1000 : 0;
  return <T variant="metric" style={{ fontSize: 20 }}>{clock(elapsed)}</T>;
}

function Amrap({
  block,
  restSeconds,
  onSwap,
  rounds,
  endsAt,
  done,
  onRound,
  onStart,
  onEnd,
}: {
  block: Block;
  restSeconds: number;
  onSwap?: (index: number) => void; // before the clock starts only: a swap mid-AMRAP splits its rounds
  rounds: number;
  endsAt: number | null;
  done: boolean;
  onRound: () => Promise<void>;
  onStart: () => void;
  onEnd: (early: boolean) => void;
}) {
  const play = useCues();
  const power = fresh(useLiveBike().power);
  // Rest between rounds runs inside the AMRAP clock; keyed by round so each "+1" restarts it.
  const [restRound, setRestRound] = useState<number | null>(null);
  const timer = useCountdown(block.duration_minutes * 60, () => {
    play('done');
    setRestRound(null);
    onEnd(false);
  });
  // The clock lives in the saved progress: leaving the screen (or an app kill) resumes it,
  // and if it ran out meanwhile the block closes.
  const resume = useRef({ endsAt, done, start: timer.start, onEnd });
  useEffect(() => {
    const r = resume.current;
    if (r.endsAt == null || r.done) return;
    const left = (r.endsAt - Date.now()) / 1000;
    if (left > 0) r.start(left);
    else r.onEnd(false);
  }, []);
  return (
    <Panel>
      <Row style={{ justifyContent: 'space-between' }}>
        <T variant="hero" style={{ fontSize: 48, lineHeight: 56 }}>
          {clock(timer.running ? timer.remainingSeconds : block.duration_minutes * 60)}
        </T>
        <View style={{ alignItems: 'flex-end' }}>
          <T variant="label">Rodadas</T>
          <T variant="metric" color={rounds > 0 ? colors.kryptonite : colors.bone}>{rounds}</T>
        </View>
      </Row>
      {block.exercises.map((rx, i) => (
        <Row key={i} style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <T>{rx.name}</T>
            <T variant="hint">{rxSummary(rx)}</T>
            <Row style={{ gap: space.lg }}>
              <DemoLink name={rx.name} />
              {onSwap && endsAt == null && !done && rx.pattern !== 'sprint' && (
                <TextLink label="Trocar ▸" accessibilityLabel={`Trocar ${rx.name}`} onPress={() => onSwap(i)} />
              )}
            </Row>
          </View>
          {rx.pattern === 'sprint' && power != null && <Badge label={`${power} W`} color={colors.amber} />}
          {rx.mode === 'timed' && rx.duration_seconds && <TimerButton seconds={rx.duration_seconds} />}
        </Row>
      ))}
      {timer.running && restRound != null && restSeconds > 0 && (
        <RoundRest key={restRound} seconds={Math.min(restSeconds, timer.remainingSeconds)}
          onDone={() => setRestRound(null)} />
      )}
      {timer.running ? (
        <>
          <Button label="+1 rodada" onPress={async () => {
            await onRound();
            setRestRound(rounds + 1);
          }} />
          <Button
            tone="ghost"
            label="Encerrar bloco agora"
            onPress={() => {
              timer.stop();
              setRestRound(null);
              onEnd(true);
            }}
          />
        </>
      ) : done || endsAt != null ? (
        <Button tone="ghost" label="Registrar rodada extra" onPress={onRound} />
      ) : (
        <Button
          label="Iniciar AMRAP (máximo de rodadas)"
          onPress={() => {
            play('phase');
            onStart();
            timer.start();
          }}
        />
      )}
    </Panel>
  );
}

/** Prescribed rest between AMRAP rounds: the block clock keeps running, so it is a strip, not a screen. */
function RoundRest({ seconds, onDone }: { seconds: number; onDone: () => void }) {
  const play = useCues();
  const timer = useCountdown(seconds, (lateMs) => {
    if (lateMs <= LATE_MS) play('done');
    onDone();
  });
  const init = useRef({ start: timer.start, seconds });
  useEffect(() => {
    const r = init.current;
    r.start();
    return scheduleRestAlert(r.seconds, 'Próxima rodada. Executar.');
  }, []);
  return (
    <Row style={styles.roundRest}>
      <View style={{ flex: 1 }}>
        <T variant="label">Descanso entre rodadas</T>
        <T variant="metric" color={timer.remainingSeconds <= 5 ? colors.amber : colors.bone}>
          {clock(timer.remainingSeconds)}
        </T>
      </View>
      <Button tone="ghost" label="Pular" onPress={onDone} />
    </Row>
  );
}

type SwapTarget = { key: string; block: number; index: number };

/** Alternatives for one exercise: same movement pattern, equipment the athlete has. */
function SwapSheet({
  athleteId,
  day,
  target,
  current,
  onPick,
  onClose,
}: {
  athleteId: string;
  day: string;
  target: SwapTarget;
  current: Prescription | null;
  onPick: (rx: Prescription) => void;
  onClose: () => void;
}) {
  const [options, setOptions] = useState<Prescription[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.alternatives(athleteId, day, target.block, target.index)
      .then(setOptions)
      .catch(() => setError('Sem conexão: as alternativas vêm do servidor.'));
  }, [athleteId, day, target.block, target.index]);
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T variant="title">Trocar exercício</T>
            <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}><T variant="label">Fechar</T></Pressable>
          </Row>
          {current && <T variant="hint">No lugar de: {current.name}</T>}
          {error && <T color={colors.amber}>{error}</T>}
          {!options && !error && <ActivityIndicator color={colors.concrete} />}
          {options?.length === 0 && <T color={colors.concrete}>Nenhuma alternativa com o seu equipamento.</T>}
          {options?.map((rx) => (
            <Pressable key={rx.exercise_id} onPress={() => onPick(rx)} accessibilityRole="button">
              <Panel>
                <T>{rx.name}</T>
                <T variant="hint">{rxSummary(rx)}</T>
              </Panel>
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// Past this, the countdown ended while JS was suspended and the OS notification already sounded.
const LATE_MS = 1500;
const REST_STEP = 15;

type UpNext = { name: string; set: string; detail: string };

function upNextOf(rx: Prescription, set: number, load: number | null): UpNext {
  const detail = [
    load != null && load > 0 ? `${String(load).replace('.', ',')} kg` : null,
    rx.target_rpe != null ? `esforço alvo ${String(rx.target_rpe).replace('.', ',')}` : null,
  ].filter(Boolean).join(' · ');
  return { name: rx.name, set: `Série ${set}/${rx.sets}`, detail };
}

/** Rest between sets: full screen by default (it is the screen seen most mid-workout), minimizable to a bar. */
function Rest({
  seconds,
  next,
  upNext,
  onDone,
  onSkip,
}: {
  seconds: number;
  next: string;
  upNext: UpNext | null;
  onDone: (late: boolean) => void;
  onSkip: () => void;
}) {
  const play = useCues();
  const insets = useSafeAreaInsets();
  const [total, setTotal] = useState(seconds);
  const [minimized, setMinimized] = useState(false);
  const timer = useCountdown(seconds, (lateMs) => {
    const late = lateMs > LATE_MS;
    if (!late) play('done');
    onDone(late);
  });
  // Unmount (done, skipped, set undone, screen left) cancels the OS alert and clears it from the tray.
  const cancelAlert = useRef<(() => void) | null>(null);
  const init = useRef({ start: timer.start, seconds, next });
  useEffect(() => {
    const r = init.current;
    r.start();
    cancelAlert.current = scheduleRestAlert(r.seconds, r.next);
    return () => cancelAlert.current?.();
  }, []);

  const adjust = (delta: number) => {
    const left = timer.extend(delta);
    setTotal((t) => Math.max(left, t + delta));
    cancelAlert.current?.();
    cancelAlert.current = left > 0 ? scheduleRestAlert(left, next) : null;
    Haptics.selectionAsync().catch(() => {});
  };

  const left = timer.remainingSeconds;
  const ending = left <= 5;
  const timeColor = ending ? colors.amber : colors.bone;

  if (minimized) {
    return (
      <View style={[styles.restBar, { paddingBottom: space.md + insets.bottom }]}>
        <Pressable onPress={() => setMinimized(false)} accessibilityRole="button" hitSlop={8}
          accessibilityLabel={`Descanso, ${left} segundos. Abrir em tela cheia`} style={{ flex: 1 }}>
          <T variant="label">Descanso ▴</T>
          <T variant="metric" color={timeColor}>{clock(left)}</T>
        </Pressable>
        <Button tone="ghost" label={`+${clock(REST_STEP)}`} onPress={() => adjust(REST_STEP)}
          accessibilityLabel={`Mais ${REST_STEP} segundos`} />
        <Button tone="ghost" label="Pular" onPress={onSkip} />
      </View>
    );
  }

  return (
    <View style={[styles.restFull, { paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.lg }]}
      accessibilityViewIsModal>
      <Row style={{ justifyContent: 'space-between', alignSelf: 'stretch' }}>
        <T variant="label">Descanso</T>
        <LiveHr />
        <TextLink label="Minimizar ▾" onPress={() => setMinimized(true)} accessibilityLabel="Minimizar descanso" />
      </Row>

      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: space.xl, alignSelf: 'stretch' }}>
        <RestRing progress={total > 0 ? left / total : 0} color={timeColor} label={`${left} segundos de descanso`}>
          <T variant="hero" color={timeColor} style={{ fontSize: 60, lineHeight: 68 }}>{clock(left)}</T>
          <T variant="label">de {clock(total)}</T>
        </RestRing>
        <Row style={{ alignSelf: 'stretch' }}>
          <Button tone="ghost" label={`−${clock(REST_STEP)}`} onPress={() => adjust(-REST_STEP)} disabled={left <= REST_STEP}
            accessibilityLabel={`Menos ${REST_STEP} segundos`} style={{ flex: 1 }} />
          <Button tone="ghost" label={`+${clock(REST_STEP)}`} onPress={() => adjust(REST_STEP)}
            accessibilityLabel={`Mais ${REST_STEP} segundos`} style={{ flex: 1 }} />
        </Row>
      </View>

      {upNext && (
        <Panel style={{ alignSelf: 'stretch' }}>
          <T variant="label">A seguir · {upNext.set}</T>
          <T style={{ fontSize: 18 }}>{upNext.name}</T>
          {upNext.detail !== '' && <T variant="hint">{upNext.detail}</T>}
        </Panel>
      )}
      <Button label="Pular descanso" onPress={onSkip} style={{ alignSelf: 'stretch' }} />
    </View>
  );
}

/** Square-capped ring that empties as the rest runs down. */
function RestRing({ progress, color, label, children }: {
  progress: number;
  color: string;
  label: string;
  children: ReactNode;
}) {
  const size = 248;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      accessible accessibilityRole="timer" accessibilityLabel={label}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.seam} strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={`${c} ${c}`} strokeDashoffset={c * (1 - Math.min(1, Math.max(0, progress)))}
          rotation={-90} origin={`${size / 2}, ${size / 2}`} />
      </Svg>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.void },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomColor: colors.seam,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  content: { padding: space.lg, gap: space.xl, paddingBottom: 160 },
  target: { flex: 1, minHeight: 44, justifyContent: 'center' },
  setHeader: { minHeight: 44, justifyContent: 'center', gap: space.sm },
  roundRest: { borderWidth: 1, borderColor: colors.amber, padding: space.md },
  dot: { width: 10, height: 10, borderWidth: 1, borderColor: colors.concrete },
  restBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.gunmetal,
    borderTopColor: colors.amber,
    borderTopWidth: 2,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
  },
  restFull: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.void,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    gap: space.lg,
  },
});
