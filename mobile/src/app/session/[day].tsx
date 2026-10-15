import * as Crypto from 'expo-crypto';
import { useKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Block, Prescription, Session, SetLog } from '../../api/types';
import { SetRunner, type SetResult } from '../../components/SetRunner';
import { LiveHr } from '../../components/LiveHr';
import { TimerButton } from '../../components/TimerButton';
import { fresh, useDevices } from '../../ble/devices';
import { Badge, Button, Panel, Row, T } from '../../components/ui';
import { clock, repsToLog, rxSummary } from '../../engine/format';
import { blockComplete, blockLocked, itemKey, sessionComplete, type Progress } from '../../engine/progress';
import { useComms } from '../../hooks/useComms';
import { useCountdown } from '../../hooks/useCountdown';
import { useCues } from '../../hooks/useCues';
import { cachedSession, enqueueLogs, loadProgress, saveProgress, storedAthlete } from '../../storage/db';
import { flushAll, loadSession } from '../../sync';
import { colors, space } from '../../theme';

const BLOCK_CALLOUT: Record<string, string> = {
  prep: 'Bloco um. Preparação de tecido e movimento.',
  strength: 'Bloco dois liberado. Torso e força bruta.',
  conditioning: 'Bloco três. AMRAP.',
};

function makeLog(day: string, rx: Prescription, setIndex: number, r: Partial<SetResult>): SetLog {
  return {
    id: Crypto.randomUUID(),
    performed_on: day,
    exercise_id: rx.exercise_id,
    set_index: setIndex,
    reps: r.reps ?? null,
    load_kg: r.load_kg ?? null,
    duration_seconds: r.duration_seconds ?? null,
    rpe: r.rpe ?? null,
  };
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
  const [restFor, setRestFor] = useState<{ id: number; seconds: number; next: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Latest progress, so handlers that await storage never write from a stale snapshot.
  const progressRef = useRef<Progress | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);

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

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const update = useCallback(
    (fn: (p: Progress) => Progress) => {
      const prev = progressRef.current;
      if (!prev || !session) return;
      const next = fn({ ...prev, startedAt: prev.startedAt ?? Date.now() });
      // Announce the block this change unlocks.
      const unlocked = session.blocks.find(
        (b) => blockLocked(session, b.order, prev) && !blockLocked(session, b.order, next),
      );
      if (unlocked) {
        comms.say(BLOCK_CALLOUT[unlocked.kind] ?? unlocked.name);
        play('phase');
      }
      if (!next.finishedAt && sessionComplete(session, next)) {
        next.finishedAt = Date.now();
        comms.say('Sessão concluída. Desligando.');
        if (athleteId) flushAll(athleteId);
      }
      progressRef.current = next;
      setProgress(next);
      saveProgress(day, next);
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

  const elapsed = progress.startedAt ? ((progress.finishedAt ?? now) - progress.startedAt) / 1000 : 0;
  const done = sessionComplete(session, progress);

  async function logSet(block: Block, index: number, rx: Prescription, r: SetResult) {
    const key = itemKey(block.order, index);
    const setIndex = progressRef.current?.setsDone[key] ?? 0;
    await enqueueLogs([makeLog(day, rx, setIndex, r)]);
    if (r.load_kg != null) setLastLoad((m) => ({ ...m, [rx.exercise_id]: r.load_kg as number }));
    update((p) => ({ ...p, setsDone: { ...p.setsDone, [key]: setIndex + 1 } }));
    const finished = setIndex + 1 >= rx.sets;
    if (finished) setActive(null);
    const rest = Math.min(block.rest_seconds, session!.rest_cap_seconds);
    if (rest > 0) {
      const next = finished ? 'Próximo exercício.' : `Série ${setIndex + 2}. Executar.`;
      comms.say(`Descanso. ${rest} segundos.`);
      setRestFor((prev) => ({ id: (prev?.id ?? 0) + 1, seconds: rest, next }));
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12}>
          <T variant="label">◂ Sair</T>
        </Pressable>
        <Row>
          <T variant="metric" style={{ fontSize: 20 }}>{clock(elapsed)}</T>
          <LiveHr />
        </Row>
        <Pressable onPress={comms.toggle} accessibilityRole="button" hitSlop={12}>
          <T variant="label" color={comms.muted ? colors.amber : colors.concrete}>
            {comms.muted ? 'Comms off' : 'Comms on'}
          </T>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <T variant="title">{session.day_name}</T>
        {done && (
          <Panel accent={colors.kryptonite}>
            <T variant="title" color={colors.kryptonite}>Sessão concluída</T>
            <T color={colors.concrete}>{clock(elapsed)} · séries registradas e enviadas quando houver sinal.</T>
          </Panel>
        )}

        {session.blocks.map((block) => {
          const locked = blockLocked(session, block.order, progress);
          const complete = blockComplete(session, block.order, progress);
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
                        <Pressable style={{ flex: 1 }} onPress={() => toggle(!checked)} accessibilityRole="checkbox"
                          accessibilityState={{ checked }}>
                          <T color={checked ? colors.kryptonite : colors.bone}>{rx.name}</T>
                          <T variant="label" style={{ textTransform: 'none' }}>{rxSummary(rx)}</T>
                        </Pressable>
                        {rx.mode === 'timed' && rx.duration_seconds && !checked && (
                          <TimerButton seconds={rx.duration_seconds} onDone={() => toggle(true)} />
                        )}
                      </Row>
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
                      <Pressable onPress={() => setActive(isActive ? null : key)} accessibilityRole="button">
                        <Panel accent={finished ? colors.kryptonite : isActive ? colors.bone : undefined}>
                          <Row style={{ justifyContent: 'space-between' }}>
                            <T color={finished ? colors.kryptonite : colors.bone} style={{ flex: 1 }}>{rx.name}</T>
                            <T variant="label">{doneSets}/{rx.sets}</T>
                          </Row>
                          <T variant="label" style={{ textTransform: 'none' }}>{rxSummary(rx)}</T>
                        </Panel>
                      </Pressable>
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
                  rounds={progress.amrapRounds[block.order] ?? 0}
                  onRound={async () => {
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
                    comms.say(`Round ${round + 1}.`);
                  }}
                  onStart={() => comms.say(`AMRAP. ${block.duration_minutes} minutos. Executar.`)}
                  onEnd={() => comms.say('Tempo. AMRAP encerrado.')}
                />
              )}
            </View>
          );
        })}
      </ScrollView>

      {restFor && (
        <Rest
          key={restFor.id}
          seconds={restFor.seconds}
          onDone={() => {
            comms.say(restFor.next);
            setRestFor(null);
          }}
          onSkip={() => setRestFor(null)}
        />
      )}
    </SafeAreaView>
  );
}

function Amrap({
  block,
  rounds,
  onRound,
  onStart,
  onEnd,
}: {
  block: Block;
  rounds: number;
  onRound: () => void;
  onStart: () => void;
  onEnd: () => void;
}) {
  const play = useCues();
  const power = fresh(useDevices().power);
  const timer = useCountdown(block.duration_minutes * 60, () => {
    play('done');
    onEnd();
  });
  return (
    <Panel>
      <Row style={{ justifyContent: 'space-between' }}>
        <T variant="hero" style={{ fontSize: 48, lineHeight: 56 }}>
          {clock(timer.running ? timer.remainingSeconds : block.duration_minutes * 60)}
        </T>
        <View style={{ alignItems: 'flex-end' }}>
          <T variant="label">Rounds</T>
          <T variant="metric" color={rounds > 0 ? colors.kryptonite : colors.bone}>{rounds}</T>
        </View>
      </Row>
      {block.exercises.map((rx, i) => (
        <Row key={i} style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <T>{rx.name}</T>
            <T variant="label" style={{ textTransform: 'none' }}>{rxSummary(rx)}</T>
          </View>
          {rx.pattern === 'sprint' && power != null && <Badge label={`${power} W`} color={colors.amber} />}
          {rx.mode === 'timed' && rx.duration_seconds && <TimerButton seconds={rx.duration_seconds} />}
        </Row>
      ))}
      {timer.running ? (
        <Button label="+1 round" onPress={onRound} />
      ) : (
        <Button
          label={rounds > 0 ? 'Registrar round extra' : 'Iniciar AMRAP'}
          tone={rounds > 0 ? 'ghost' : 'primary'}
          onPress={() => {
            if (rounds > 0) onRound();
            else {
              play('phase');
              onStart();
              timer.start();
            }
          }}
        />
      )}
    </Panel>
  );
}

function Rest({ seconds, onDone, onSkip }: { seconds: number; onDone: () => void; onSkip: () => void }) {
  const play = useCues();
  const timer = useCountdown(seconds, () => {
    play('done');
    onDone();
  });
  const startRef = useRef(timer.start);
  useEffect(() => startRef.current(), []);
  return (
    <View style={styles.rest}>
      <T variant="label">Descanso</T>
      <T variant="hero">{clock(timer.remainingSeconds)}</T>
      <Button tone="ghost" label="Pular" onPress={onSkip} style={{ alignSelf: 'stretch' }} />
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
  rest: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.gunmetal,
    borderTopColor: colors.amber,
    borderTopWidth: 2,
    padding: space.lg,
    alignItems: 'center',
    gap: space.sm,
  },
});
