import { StyleSheet, View } from 'react-native';

import { colors, space } from '../theme';
import { Row, T } from './ui';

/**
 * Horizontal consumption bar. Fill turns green only when the target is met
 * within tolerance, amber when it overshoots `max` (or the target by 10 %).
 */
export function Meter({
  label,
  value,
  target,
  max,
  min,
  unit,
}: {
  label: string;
  value: number;
  target: number;
  max?: number;
  min?: number;
  unit: string;
}) {
  const ceiling = max ?? target;
  const scale = Math.max(ceiling * 1.15, value, 1);
  const over = value > (max ?? target * 1.1);
  const met = !over && value >= (min ?? target * 0.9);
  const fill = over ? colors.warning : met ? colors.success : colors.accent;
  return (
    <View style={{ gap: 6 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T>{label}</T>
        <T variant="label" color={over ? colors.warning : colors.textMuted}>
          {Math.round(value)}/{Math.round(max ?? target)} {unit}
        </T>
      </Row>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.min(100, (value / scale) * 100)}%`, backgroundColor: fill }]} />
        {min != null && <View style={[styles.mark, { left: `${(min / scale) * 100}%` }]} />}
        <View style={[styles.mark, { left: `${(ceiling / scale) * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceHigh, marginBottom: space.xs },
  fill: { height: 6, borderRadius: 3 },
  mark: { position: 'absolute', top: -2, width: 2, height: 10, borderRadius: 1, backgroundColor: colors.textMuted },
});
