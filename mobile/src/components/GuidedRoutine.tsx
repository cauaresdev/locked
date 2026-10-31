import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { clock } from '../engine/format';
import { EVENING_ROUTINE, positionAt, totalSeconds } from '../engine/guided';
import { useComms } from '../hooks/useComms';
import { colors, space } from '../theme';
import { Button, Dots, ProgressBar, T } from './ui';

const KEEP_AWAKE_TAG = 'guided-routine';

/** Full-screen evening mobility + breathing, on a wall clock, with voice at every change. */
export function GuidedRoutine({ visible, onClose, onDone }: { visible: boolean; onClose: () => void; onDone: () => void }) {
  const comms = useComms();
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const said = useRef<string>('');
  const steps = EVENING_ROUTINE;
  const total = totalSeconds(steps);
  const elapsed = startedAt ? (now - startedAt) / 1000 : 0;
  const pos = positionAt(steps, elapsed);
  const step = pos.index >= 0 ? steps[pos.index] : null;
  const finished = startedAt != null && pos.index < 0;

  useEffect(() => {
    if (!startedAt || finished) return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => {
      clearInterval(id);
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [startedAt, finished]);

  // Voice and a tap at each new drill or breathing phase; the end marks the habit done.
  useEffect(() => {
    if (!startedAt) return;
    const key = pos.index < 0 ? 'end' : `${pos.index}:${pos.breath ?? ''}`;
    if (key === said.current) return;
    said.current = key;
    Haptics.selectionAsync().catch(() => {});
    if (pos.index < 0) {
      comms.say('Rotina noturna concluída. Boa noite.');
      onDone();
    } else if (pos.breath) {
      comms.say(pos.breath);
    } else if (step) {
      comms.say(step.name);
    }
  }, [startedAt, pos.index, pos.breath, step, comms, onDone]);

  function close() {
    setStartedAt(null);
    said.current = '';
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <SafeAreaView style={styles.root}>
        <View style={{ gap: space.xs }}>
          <T variant="label">Rotina noturna · {clock(total)}</T>
          <ProgressBar value={elapsed / total} />
        </View>
        <View style={styles.center}>
          {!startedAt ? (
            <>
              <T variant="display">Mobilidade e respiração</T>
              {steps.map((s) => (
                <T key={s.name} color={colors.textMuted}>{s.name} · {clock(s.seconds)}</T>
              ))}
              <T variant="hint">Faça depois de desligar as telas. A voz avisa cada troca; a tela fica acesa.</T>
            </>
          ) : finished ? (
            <>
              <T variant="display" color={colors.success}>Concluída</T>
              <T variant="hint" style={{ textAlign: 'center' }}>Mobilidade marcada na rotina. Agora, cama.</T>
            </>
          ) : step ? (
            <>
              <Dots done={pos.index} total={steps.length} color={colors.success} />
              <T variant="display" style={{ textAlign: 'center' }}>{step.name}</T>
              {pos.breath ? (
                <>
                  <T variant="title" color={colors.accent} style={{ textAlign: 'center' }}>{pos.breath}</T>
                  <T variant="hero" style={{ fontSize: 96, lineHeight: 104 }}>{pos.breathLeft}</T>
                </>
              ) : (
                <T variant="hero" style={{ fontSize: 72, lineHeight: 80 }}>{clock(pos.left)}</T>
              )}
              <T variant="hint" style={{ textAlign: 'center' }}>{step.cue}</T>
            </>
          ) : null}
        </View>
        <View style={{ gap: space.sm }}>
          {!startedAt && <Button icon="play" label="Começar" onPress={() => { said.current = ''; setNow(Date.now()); setStartedAt(Date.now()); }} />}
          <Button tone="secondary" label={startedAt && !finished ? 'Parar' : 'Fechar'} onPress={close} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: space.lg, gap: space.xl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg },
});
