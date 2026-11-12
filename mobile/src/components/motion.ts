import { AccessibilityInfo } from 'react-native';

// Motion is short and physical, and off when the system asks for reduced motion.
let reduced = false;
AccessibilityInfo.isReduceMotionEnabled?.()
  .then((v) => (reduced = v))
  .catch(() => {});
AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => (reduced = v));

export function reduceMotion(): boolean {
  return reduced;
}

/** A duration, or 0 under reduced motion. */
export function ms(n: number): number {
  return reduced ? 0 : n;
}
