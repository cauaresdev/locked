import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Prescription } from '../api/types';
import { clock, repsToLog, workSeconds } from '../engine/format';
import { PHASE_LABEL } from '../engine/tempo';
import { useCountdown } from '../hooks/useCountdown';
import { useCues } from '../hooks/useCues';
import { useMetronome } from '../hooks/useMetronome';
import { colors, space } from '../theme';
import { Button, Field, Panel, Row, T } from './ui';

export interface SetResult {
  reps: number | null;
  load_kg: number | null;
  duration_seconds: number | null;
  rpe: number | null;
}

const num = (s: string) => (s.trim() ? Number(s.replace(',', '.')) : null);

/** Executes and logs one set: metronome for tempo work, countdown for timed/hold work. */
export function SetRunner({
  rx,
  setNumber,
  defaultLoad,
  onLog,
}: {
  rx: Prescription;
  setNumber: number;
  defaultLoad: number | null;
  onLog: (r: SetResult) => void;
}) {
  const [reps, setReps] = useState(String(repsToLog(rx) ?? ''));
  // Bodyweight lifts log added load; 0 still counts for e1RM (body mass is added server-side).
  const initialLoad = defaultLoad ?? (rx.implement === 'bodyweight' ? 0 : null);
  const [load, setLoad] = useState(initialLoad != null ? String(initialLoad) : '');
  const [rpe, setRpe] = useState(rx.target_rpe != null ? String(rx.target_rpe) : '');
  const timed = rx.mode !== 'reps';

  return (
    <Panel style={{ backgroundColor: colors.void }}>
      <T variant="label">Série {setNumber}/{rx.sets}</T>
      {rx.tempo && rx.mode === 'reps' && <Metronome rx={rx} />}
      {timed && <WorkTimer seconds={workSeconds(rx)} />}
      {rx.cues.length > 0 && <T variant="label" style={{ textTransform: 'none' }}>▸ {rx.cues.join(' · ')}</T>}
      <Row style={{ alignItems: 'flex-end' }}>
        {!timed && (
          <Field label={rx.reps_per_side ? 'Reps/lado' : 'Reps'} value={reps} onChangeText={setReps} keyboardType="number-pad" />
        )}
        <Field label={rx.implement === 'bodyweight' ? 'Lastro kg' : 'Carga kg'} value={load} onChangeText={setLoad} keyboardType="decimal-pad" placeholder="—" />
        <Field label="RPE" value={rpe} onChangeText={setRpe} keyboardType="decimal-pad" placeholder="—" />
      </Row>
      <Button
        label="Registrar série"
        onPress={() =>
          onLog({
            reps: timed ? null : num(reps),
            load_kg: num(load),
            duration_seconds: timed ? workSeconds(rx) : null,
            rpe: num(rpe),
          })
        }
      />
    </Panel>
  );
}

function Metronome({ rx }: { rx: Prescription }) {
  const reps = rx.reps ?? rx.reps_per_side ?? 1;
  const m = useMetronome(rx.tempo, reps, rx.pattern);
  const { state } = m;
  return (
    <View style={styles.center}>
      {m.running && state.leadIn > 0 ? (
        <T variant="hero" color={colors.amber}>{state.leadIn}</T>
      ) : m.running && state.phase ? (
        <>
          <T variant="label">Rep {state.rep}/{reps}{rx.reps_per_side ? ' (por lado)' : ''}</T>
          <T variant="title">{PHASE_LABEL[state.phase]}</T>
          <T variant="hero">{state.secondInPhase}<T variant="metric" color={colors.concrete}>/{state.phaseSeconds}</T></T>
        </>
      ) : (
        <T variant="label">Metrônomo · {m.totalSeconds} s sob tensão</T>
      )}
      <Button tone="ghost" label={m.running ? 'Parar' : 'Metrônomo'} onPress={m.running ? m.stop : m.start}
        style={{ alignSelf: 'stretch' }} />
    </View>
  );
}

function WorkTimer({ seconds }: { seconds: number }) {
  const play = useCues();
  const t = useCountdown(seconds, () => play('done'));
  return (
    <View style={styles.center}>
      <T variant="hero" color={t.running ? colors.bone : colors.concrete}>
        {clock(t.running ? t.remainingSeconds : seconds)}
      </T>
      <Button
        tone="ghost"
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
});
