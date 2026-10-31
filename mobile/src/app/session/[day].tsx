import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Storage from 'expo-sqlite/kv-store';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import type { Block, Prescription, Session, SetLog } from '../../api/types';
import { SetRunner, type SetResult } from '../../components/SetRunner';
import { LiveHr } from '../../components/LiveHr';
import { TimerButton } from '../../components/TimerButton';
import { fresh, useLiveBike } from '../../ble/devices';
import { ExerciseThumb, HowToLink } from '../../components/ExerciseDemo';
import { Icon } from '../../components/Icon';
import { Badge, Button, Dots, Panel, Row, Stat, T, TextLink } from '../../components/ui';
import { isRecord, sessionSummary, setE1rm } from '../../engine/athlete';
import { clock, repsToLog, rxSummary } from '../../engine/format';
import {
  applySwaps,
  blockComplete,
  blockLocked,
  emptyProgress,
  itemKey,
  loggedSets,
  sessionComplete,
  startingLoad,
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
import { colors, radius, space } from '../../theme';

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
    distance_m: r.distance_m ?? null,
    rpe: r.rpe ?? null,
    performed_at: new Date().toISOString(), // dates the strength block for the energy estimate
  };
}

/** A video search for the exercise: the catalog has cues but no demonstrations of its own. */
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
  const [recordFlash, setRecordFlash] = useState<string | null>(null);
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
            <T color={colors.warning}>{loadError}</T>
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
      // A record beats the best estimate on file and anything heavier already done today.
      const e1rm = rx.implement === 'bodyweight' ? null : setE1rm(r.load_kg, r.reps, r.rpe);
      const today = loggedSets(progressRef.current ?? emptyProgress())
        .filter((x) => x.exercise === rx.name)
        .map((x) => setE1rm(x.load_kg, x.reps, x.rpe) ?? 0);
      const best = rx.best_e1rm_kg == null ? null : Math.max(rx.best_e1rm_kg, ...today);
      const record = isRecord(e1rm, best);
      update((p) => withSetLogged(p, key, entry.id,
        { exercise: rx.name, reps: r.reps, load_kg: r.load_kg, rpe: r.rpe, record }));
      if (record) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        comms.say('Novo recorde.');
        setRecordFlash(`${rx.name}: 1RM estimado ${String(e1rm).replace('.', ',')} kg`);
      } else {
        Haptics.selectionAsync().catch(() => {});
      }
      const finished = setIndex + 1 >= rx.sets;
      const setsOf = (i: number) => progressRef.current?.setsDone[itemKey(block.order, i)] ?? 0;
      // Superset: rest 0 on the first exercise sends straight to the second; the rest comes after the
      // second, which then hands back to the first while it still has sets.
      const partner = block.exercises[index + 1];
      if (rx.rest_seconds === 0 && partner && setsOf(index + 1) < partner.sets) {
        setActive(itemKey(block.order, index + 1));
        comms.say(`${partner.name}. Sem descanso.`);
        return;
      }
      const first = block.exercises[index - 1];
      const backToFirst = first?.rest_seconds === 0 && setsOf(index - 1) < first.sets;
      if (backToFirst) setActive(itemKey(block.order, index - 1));
      else if (finished) setActive(null);
      const rest = Math.min(rx.rest_seconds ?? block.rest_seconds, session.rest_cap_seconds);
      if (rest > 0) {
        // What comes after the rest: the superset's first half, this lift's next set, or the next lift of the block.
        const nextIndex = backToFirst ? index - 1 : finished ? index + 1 : index;
        const nextRx = block.exercises[nextIndex];
        const nextSet = nextIndex === index ? setIndex + 2 : setsOf(nextIndex) + 1;
        const next = nextIndex === index ? `Série ${nextSet}. Executar.`
          : backToFirst ? `Supersérie, série ${nextSet}. Executar.` : 'Próximo exercício.';
        const upNext =
          nextRx && nextSet <= nextRx.sets
            ? upNextOf(nextRx, nextSet, nextIndex === index ? r.load_kg
              : startingLoad(block, nextIndex, progressRef.current ?? emptyProgress(), lastLoad))
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
            duration_seconds: rx.mode === 'timed' || rx.mode === 'hold' ? rx.duration_seconds : null,
            distance_m: rx.mode === 'distance' ? rx.distance_m : null,
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
          hitSlop={8} style={styles.iconBtn}>
          <Icon name="chevron-left" size={22} color={colors.text} />
        </Pressable>
        <Row>
          <Elapsed startedAt={progress.startedAt} finishedAt={progress.finishedAt} />
          <LiveHr />
        </Row>
        <Pressable onPress={comms.toggle} accessibilityRole="switch" accessibilityLabel="Comandos de voz"
          accessibilityState={{ checked: !comms.muted }} hitSlop={8}
          style={[styles.voice, comms.muted && { backgroundColor: colors.warningFill }]}>
          <T variant="label" color={comms.muted ? colors.warning : colors.textMuted}>
            {comms.muted ? 'Voz off' : 'Voz on'}
          </T>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
      >
        <T variant="display" style={{ fontSize: 26, lineHeight: 32 }}>{session.day_name}</T>
        {done && <SessionSummary progress={progress} />}
        {recordFlash && !done && (
          <Panel accent={colors.accent}>
            <Row style={{ gap: space.sm }}>
              <Icon name="bolt" size={20} color={colors.accent} />
              <T variant="title" color={colors.accent} style={{ flex: 1 }}>Novo recorde</T>
              <TextLink label="Fechar" color={colors.textMuted} onPress={() => setRecordFlash(null)} />
            </Row>
            <T>{recordFlash}</T>
          </Panel>
        )}

        {view.deload && (
          <Badge label="Deload: semana de descarga" color={colors.warning} />
        )}
        {view.notices.map((n) => (
          <Panel key={n} accent={colors.warning}><T variant="hint" color={colors.warning}>{n}</T></Panel>
        ))}

        {view.blocks.map((block) => {
          const locked = blockLocked(view, block.order, progress);
          const complete = blockComplete(view, block.order, progress);
          return (
            <View key={block.order} style={{ gap: space.md }}>
              <View style={{ gap: 2 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T variant="label" color={complete ? colors.success : colors.textMuted}>
                    Bloco {block.order} · {block.duration_minutes} min
                  </T>
                  {locked && <Badge label="Bloqueado" color={colors.warning} />}
                  {complete && <Badge label="Concluído" color={colors.success} />}
                </Row>
                <T variant="title" accessibilityRole="header">{block.name}</T>
              </View>
              {locked ? (
                <Panel accent={colors.warning}>
                  <T color={colors.warning}>
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
                    <Panel key={key}>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Pressable style={styles.target}
                          onPress={() => {
                            Haptics.selectionAsync().catch(() => {});
                            toggle(!checked);
                          }}
                          accessibilityRole="checkbox" accessibilityState={{ checked }}>
                          <Row style={{ gap: space.md }}>
                            <View style={[styles.check, checked && styles.checkOn]}>
                              {checked && <Icon name="check" size={14} color={colors.bg} strokeWidth={3} />}
                            </View>
                            <View style={{ flex: 1 }}>
                              <T color={checked ? colors.textMuted : colors.text}
                                style={checked ? { textDecorationLine: 'line-through' } : null}>{rx.name}</T>
                              <T variant="hint">{rxSummary(rx)}</T>
                            </View>
                          </Row>
                        </Pressable>
                        {rx.mode === 'timed' && rx.duration_seconds && !checked && (
                          <TimerButton seconds={rx.duration_seconds} onDone={() => toggle(true)} />
                        )}
                      </Row>
                      {/* A sibling, not inside the checkbox: links never nest in another control. */}
                      <HowToLink rx={rx} />
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
                      <Panel raised={isActive && !finished}>
                        {/* Only the header toggles the set runner; the links below are its siblings. */}
                        <Pressable onPress={() => setActive(isActive ? null : key)} accessibilityRole="button"
                          accessibilityLabel={`${rx.name}, ${doneSets} de ${rx.sets} séries`}
                          accessibilityState={{ expanded: isActive && !finished }}
                          style={styles.setHeader}>
                          <Row style={{ justifyContent: 'space-between' }}>
                            <ExerciseThumb exerciseId={rx.exercise_id} size={40} />
                            <T variant="title" color={finished ? colors.textMuted : colors.text} style={{ flex: 1, fontSize: 16 }}>
                              {rx.name}
                            </T>
                            {finished
                              ? <Icon name="check" size={20} color={colors.success} strokeWidth={2.5} />
                              : <Dots done={doneSets} total={rx.sets} color={colors.success} />}
                          </Row>
                          <T variant="hint">{rxSummary(rx)}</T>
                        </Pressable>
                        <Row style={{ gap: space.lg }}>
                          <HowToLink rx={rx} />
                          {doneSets === 0 && athleteId && !rx.set_role && block.kind !== 'prep' && (
                            <TextLink label="Trocar" accessibilityLabel={`Trocar ${rx.name}`}
                              onPress={() => setSwapFor({ key, block: block.order, index: i })} />
                          )}
                          {doneSets > 0 && (
                            <TextLink label="Desfazer série" color={colors.warning}
                              accessibilityLabel={`Desfazer última série de ${rx.name}`} onPress={() => undoSet(key)} />
                          )}
                        </Row>
                      </Panel>
                      {isActive && !finished && (
                        <SetRunner
                          key={`${key}:${doneSets}`}
                          rx={rx}
                          setNumber={doneSets + 1}
                          defaultLoad={startingLoad(block, i, progress, lastLoad)}
                          prep={block.kind === 'prep'}
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

/** Session clock, ticking on its own so the rest of the screen doesn't re-render every second. */
function SessionSummary({ progress }: { progress: Progress }) {
  const sum = sessionSummary(loggedSets(progress));
  const minutes = ((progress.finishedAt ?? 0) - (progress.startedAt ?? 0)) / 1000;
  return (
    <Panel accent={colors.success} style={{ gap: space.md }}>
      <T variant="title" color={colors.success}>Sessão concluída</T>
      <Row style={{ justifyContent: 'space-between' }}>
        <Stat value={clock(minutes)} label="duração" />
        <Stat value={String(sum.sets)} label="séries" />
        <Stat value={sum.volumeKg.toLocaleString('pt-BR')} unit="kg" label="volume" />
      </Row>
      {sum.records.length > 0 && (
        <T color={colors.accent}>Recorde: {sum.records.join(', ')}</T>
      )}
      <T variant="hint">Séries enviadas quando houver sinal. Agora: proteína, água e sono.</T>
    </Panel>
  );
}

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
    <Panel style={{ gap: space.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T variant="hero" style={{ fontSize: 48, lineHeight: 56 }}>
          {clock(timer.running ? timer.remainingSeconds : block.duration_minutes * 60)}
        </T>
        <View style={{ alignItems: 'flex-end' }}>
          <T variant="label">Rodadas</T>
          <T variant="metric" color={rounds > 0 ? colors.success : colors.text}>{rounds}</T>
        </View>
      </Row>
      {block.exercises.map((rx, i) => (
        <Row key={i} style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <T>{rx.name}</T>
            <T variant="hint">{rxSummary(rx)}</T>
            <Row style={{ gap: space.lg }}>
              <HowToLink rx={rx} />
              {onSwap && endsAt == null && !done && rx.pattern !== 'sprint' && (
                <TextLink label="Trocar" accessibilityLabel={`Trocar ${rx.name}`} onPress={() => onSwap(i)} />
              )}
            </Row>
          </View>
          {rx.pattern === 'sprint' && power != null && <Badge label={`${power} W`} color={colors.warning} />}
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
            tone="secondary"
            label="Encerrar bloco agora"
            onPress={() => {
              timer.stop();
              setRestRound(null);
              onEnd(true);
            }}
          />
        </>
      ) : done || endsAt != null ? (
        <Button tone="secondary" label="Registrar rodada extra" onPress={onRound} />
      ) : (
        <Button
          icon="play"
          label="Iniciar AMRAP"
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
        <T variant="metric" color={timer.remainingSeconds <= 5 ? colors.warning : colors.text}>
          {clock(timer.remainingSeconds)}
        </T>
      </View>
      <Button tone="secondary" label="Pular" onPress={onDone} />
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
            <T variant="display" style={{ fontSize: 24, lineHeight: 30 }}>Trocar exercício</T>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Fechar" hitSlop={8}
              style={styles.iconBtn}>
              <Icon name="close" size={20} color={colors.text} />
            </Pressable>
          </Row>
          {current && <T variant="hint">No lugar de: {current.name}</T>}
          {error && <T color={colors.warning}>{error}</T>}
          {!options && !error && <ActivityIndicator color={colors.textMuted} />}
          {options?.length === 0 && <T color={colors.textMuted}>Nenhuma alternativa com o seu equipamento.</T>}
          {options?.map((rx) => (
            <Pressable key={rx.exercise_id} onPress={() => onPick(rx)} accessibilityRole="button">
              <Panel>
                <Row>
                  <ExerciseThumb exerciseId={rx.exercise_id} size={48} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <T>{rx.name}</T>
                    <T variant="hint">{rxSummary(rx)}</T>
                  </View>
                  <Icon name="chevron-right" size={18} color={colors.textFaint} />
                </Row>
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
  const timeColor = ending ? colors.warning : colors.text;

  if (minimized) {
    return (
      <View style={[styles.restBar, { paddingBottom: space.md + insets.bottom }]}>
        <Pressable onPress={() => setMinimized(false)} accessibilityRole="button" hitSlop={8}
          accessibilityLabel={`Descanso, ${left} segundos. Abrir em tela cheia`} style={{ flex: 1 }}>
          <T variant="label">Descanso · toque para abrir</T>
          <T variant="metric" color={timeColor}>{clock(left)}</T>
        </Pressable>
        <Button tone="secondary" label={`+${clock(REST_STEP)}`} onPress={() => adjust(REST_STEP)}
          accessibilityLabel={`Mais ${REST_STEP} segundos`} />
        <Button tone="secondary" label="Pular" onPress={onSkip} />
      </View>
    );
  }

  return (
    <View style={[styles.restFull, { paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.lg }]}
      accessibilityViewIsModal>
      <Row style={{ justifyContent: 'space-between', alignSelf: 'stretch' }}>
        <T variant="title">Descanso</T>
        <LiveHr />
        <TextLink label="Minimizar" onPress={() => setMinimized(true)} accessibilityLabel="Minimizar descanso" />
      </Row>

      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: space.xl, alignSelf: 'stretch' }}>
        <RestRing progress={total > 0 ? left / total : 0} color={timeColor} label={`${left} segundos de descanso`}>
          <T variant="hero" color={timeColor} style={{ fontSize: 60, lineHeight: 68 }}>{clock(left)}</T>
          <T variant="label">de {clock(total)}</T>
        </RestRing>
        <Row style={{ alignSelf: 'stretch' }}>
          <Button tone="secondary" label={`−${clock(REST_STEP)}`} onPress={() => adjust(-REST_STEP)} disabled={left <= REST_STEP}
            accessibilityLabel={`Menos ${REST_STEP} segundos`} style={{ flex: 1 }} />
          <Button tone="secondary" label={`+${clock(REST_STEP)}`} onPress={() => adjust(REST_STEP)}
            accessibilityLabel={`Mais ${REST_STEP} segundos`} style={{ flex: 1 }} />
        </Row>
      </View>

      {upNext && (
        <Panel style={{ alignSelf: 'stretch' }}>
          <T variant="label">A seguir · {upNext.set}</T>
          <T variant="title">{upNext.name}</T>
          {upNext.detail !== '' && <T variant="hint">{upNext.detail}</T>}
        </Panel>
      )}
      <Button label="Pular descanso" onPress={onSkip} style={{ alignSelf: 'stretch' }} />
    </View>
  );
}

/** Ring that empties as the rest runs down. */
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
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.surfaceHigh} strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeLinecap="round" strokeDasharray={`${c} ${c}`} strokeDashoffset={c * (1 - Math.min(1, Math.max(0, progress)))}
          rotation={-90} origin={`${size / 2}, ${size / 2}`} />
      </Svg>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  iconBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceHigh,
    alignItems: 'center', justifyContent: 'center',
  },
  voice: {
    minHeight: 44, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.pill,
    backgroundColor: colors.surfaceHigh,
  },
  check: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: colors.textMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.success, borderColor: colors.success },
  content: { padding: space.lg, gap: space.xl, paddingBottom: 160 },
  target: { flex: 1, minHeight: 44, justifyContent: 'center' },
  setHeader: { minHeight: 44, justifyContent: 'center', gap: space.sm },
  roundRest: { backgroundColor: colors.warningFill, borderRadius: radius.md, padding: space.md },
  restBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.surfaceHigh,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
  },
  restFull: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.bg,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    gap: space.lg,
  },
});
