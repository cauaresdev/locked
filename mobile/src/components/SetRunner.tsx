import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Prescription } from '../api/types';
import { loadsPlates, platesPerSide } from '../engine/athlete';
import { clock, parseDecimal as num, repsToLog, workSeconds } from '../engine/format';
import { PHASE_LABEL } from '../engine/tempo';
import { useCountdown } from '../hooks/useCountdown';
import { useCues } from '../hooks/useCues';
import { useMetronome } from '../hooks/useMetronome';
import { colors, fonts, radius, space } from '../theme';
import { Button, Field, Panel, Row, T } from './ui';

export interface SetResult {
  reps: number | null;
  load_kg: number | null;
  duration_seconds: number | null;
  distance_m: number | null;
  rpe: number | null;
}

// Whole steps carry their reps in reserve; half steps sit between them, like keys on a piano.
const RPE_WHOLE: [number, string][] = [[6, 'sobram 4+'], [7, 'sobram 3'], [8, 'sobram 2'], [9, 'sobra 1'], [10, 'falha']];
const RPE_HALF = [6.5, 7.5, 8.5, 9.5];
const UNLOADED = new Set<Prescription['implement']>(['bodyweight', 'band', 'roller', 'ergometer']);
const fmt = (n: number) => String(n).replace('.', ',');

/** Executes and logs one set: metronome for tempo work, countdown for timed/hold work. */
export function SetRunner({
  rx,
  setNumber,
  defaultLoad,
  prep = false,
  onLog,
}: {
  rx: Prescription;
  setNumber: number;
  defaultLoad: number | null;
  prep?: boolean; // preparation block: no effort rating, and no load unless something is held
  onLog: (r: SetResult) => void | Promise<void>;
}) {
  const [reps, setReps] = useState(String(repsToLog(rx) ?? ''));
  // Bodyweight lifts log added load; 0 still counts for e1RM (body mass is added server-side).
  const initialLoad = defaultLoad ?? (rx.implement === 'bodyweight' ? 0 : null);
  const [load, setLoad] = useState(initialLoad != null ? fmt(initialLoad) : '');
  // Never pre-filled with the target: an untouched default would log the plan instead of
  // the effort, and every load suggestion is computed from these ratings.
  const [rpe, setRpe] = useState<number | null>(null);
  const timed = rx.mode === 'timed' || rx.mode === 'hold';
  const distance = rx.mode === 'distance';
  const needsRpe = rx.target_rpe != null;
  const showLoad = !prep || !UNLOADED.has(rx.implement);
  const range = rx.reps_max ? ` (${repsToLog(rx)}–${rx.reps_max})` : '';

  return (
    <Panel style={{ gap: space.md }}>
      <T variant="title" style={{ fontSize: 16 }}>
        Série {setNumber}/{rx.sets}{rx.set_role === 'top' ? ' · top set' : rx.set_role === 'backoff' ? ' · back-off' : ''}
        {distance ? ` · ${rx.distance_m} m` : ''}
      </T>
      {rx.tempo && rx.mode === 'reps' && <Metronome rx={rx} />}
      {timed && <WorkTimer seconds={workSeconds(rx)} />}
      {rx.cues.length > 0 && <T variant="hint">{rx.cues.join(' · ')}</T>}
      {!prep && <History rx={rx} />}
      {setNumber === 1 && rx.warmup_sets.length > 0 && (
        <T variant="label">
          Aquecimento antes: {rx.warmup_sets.map((w) => `${fmt(w.load_kg)} kg × ${w.reps}`).join(' · ')}
        </T>
      )}
      <Row style={{ alignItems: 'flex-end' }}>
        {!timed && !distance && (
          <Field label={(rx.reps_per_side ? 'Repetições por lado' : 'Repetições') + range} value={reps}
            onChangeText={setReps} keyboardType="number-pad" />
        )}
        {showLoad && (
          <Field label={rx.implement === 'bodyweight' ? 'Lastro (kg)' : 'Carga (kg)'} value={load} onChangeText={setLoad}
            keyboardType="decimal-pad" placeholder="—" />
        )}
      </Row>
      {showLoad && loadsPlates(rx.implement) && <Plates kg={num(load)} implement={rx.implement} />}
      {!prep && <RpePicker value={rpe} target={rx.target_rpe} onChange={setRpe} />}
      <Button
        label={needsRpe && rpe == null ? 'Escolha o esforço' : 'Registrar série'}
        disabled={needsRpe && rpe == null}
        onPress={() =>
          onLog({
            reps: timed || distance ? null : num(reps),
            load_kg: showLoad ? num(load) : null,
            duration_seconds: timed ? workSeconds(rx) : null,
            distance_m: distance ? rx.distance_m : null,
            rpe,
          })
        }
      />
    </Panel>
  );
}

/** Last time this lift was done, and the best estimate to beat. */
function History({ rx }: { rx: Prescription }) {
  const last = rx.last_set;
  if (!last && rx.best_e1rm_kg == null) return null;
  const when = last ? new Date(`${last.on}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '';
  const what = last
    ? [last.load_kg ? `${fmt(last.load_kg)} kg` : null, last.reps ? `× ${last.reps}` : null,
      last.rpe ? `esforço ${fmt(last.rpe)}` : null].filter(Boolean).join(' ')
    : '';
  return (
    <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
      {last && <T variant="label">Última ({when}): {what || 'registrada'}</T>}
      {rx.best_e1rm_kg != null && (
        <T variant="label" color={colors.accent}>Recorde: 1RM est. {fmt(rx.best_e1rm_kg)} kg</T>
      )}
    </Row>
  );
}

/** Plates to load on each side for the typed weight. */
function Plates({ kg, implement }: { kg: number | null; implement: Prescription['implement'] }) {
  if (kg == null || kg <= 0) return null;
  const split = platesPerSide(kg, implement);
  if (!split) return <T variant="label">Abaixo do peso da barra (20 kg).</T>;
  const plates = split.plates.length ? split.plates.map(fmt).join(' + ') : 'nenhuma';
  const prefix = implement === 'barbell' ? 'Por lado, além da barra de 20 kg' : 'Anilhas por lado';
  return (
    <T variant="label">
      {prefix}: {plates}{split.leftover > 0 ? ` (sobra ${fmt(split.leftover)} kg)` : ''}
    </T>
  );
}

/** Rate of perceived exertion, anchored on reps in reserve so the scale means the same every set. */
function RpePicker({ value, target, onChange }: { value: number | null; target: number | null; onChange: (v: number) => void }) {
  const key = (v: number, caption?: string, half?: boolean) => {
    const on = value === v;
    return (
      <Pressable key={v} onPress={() => onChange(v)} accessibilityRole="radio" accessibilityState={{ checked: on }}
        accessibilityLabel={`Esforço ${fmt(v)}${caption ? `, ${caption}` : ''}${v === target ? ', alvo' : ''}`}
        style={[styles.rpeKey, half && styles.rpeHalf, on && styles.chipOn, v === target && !on && styles.chipTarget]}>
        <Text style={[styles.chipText, half && { fontSize: 13 }, on && { color: colors.onAccent }]}>{fmt(v)}</Text>
        {caption && (
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.rpeCaption, on && { color: colors.onAccent }]}>{caption}</Text>
        )}
      </Pressable>
    );
  };
  return (
    <View style={{ gap: space.xs }} accessibilityRole="radiogroup">
      <T variant="label">
        Esforço percebido (RPE){target != null ? ` · alvo ${fmt(target)}` : ''}
      </T>
      <View style={styles.rpeRow}>{RPE_WHOLE.map(([v, caption]) => key(v, caption))}</View>
      {/* Inset by half a key, so each half step lands between the two whole steps it splits. */}
      <View style={[styles.rpeRow, { paddingHorizontal: '10%' }]}>{RPE_HALF.map((v) => key(v, undefined, true))}</View>
    </View>
  );
}

function Metronome({ rx }: { rx: Prescription }) {
  const reps = rx.reps ?? rx.reps_per_side ?? 1;
  const m = useMetronome(rx.tempo, reps, rx.pattern);
  const { state } = m;
  return (
    <View style={styles.center}>
      {m.running && state.leadIn > 0 ? (
        <T variant="hero" color={colors.warning}>{state.leadIn}</T>
      ) : m.running && state.phase ? (
        <>
          <T variant="label">Repetição {state.rep}/{reps}{rx.reps_per_side ? ' (por lado)' : ''}</T>
          <T variant="title">{PHASE_LABEL[state.phase]}</T>
          <T variant="hero">{state.secondInPhase}<T variant="metric" color={colors.textMuted}>/{state.phaseSeconds}</T></T>
        </>
      ) : (
        <T variant="label">Metrônomo · {m.totalSeconds} s sob tensão</T>
      )}
      <Button tone="secondary" label={m.running ? 'Parar' : 'Metrônomo'} onPress={m.running ? m.stop : m.start}
        style={{ alignSelf: 'stretch' }} />
    </View>
  );
}

function WorkTimer({ seconds }: { seconds: number }) {
  const play = useCues();
  const t = useCountdown(seconds, () => play('done'));
  return (
    <View style={styles.center}>
      <T variant="hero" color={t.running ? colors.text : colors.textMuted}>
        {clock(t.running ? t.remainingSeconds : seconds)}
      </T>
      <Button
        tone="secondary"
        label={t.running ? 'Parar' : 'Iniciar'}
        onPress={() => {
          if (t.running) t.stop();
          else {
            play('phase');
            t.start();
          }
        }}
        style={{ alignSelf: 'stretch' }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  rpeRow: { flexDirection: 'row', gap: space.xs },
  rpeKey: { flex: 1, borderRadius: radius.md, borderWidth: 1.5, borderColor: 'transparent',
    backgroundColor: colors.surfaceHigh, minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 2 },
  rpeHalf: { minHeight: 44 },
  rpeCaption: { fontSize: 10, color: colors.textMuted },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipTarget: { borderColor: colors.textMuted, borderStyle: 'dashed' },
  chipText: { fontFamily: fonts.monoBold, fontSize: 15, color: colors.text, fontVariant: ['tabular-nums'] },
});
