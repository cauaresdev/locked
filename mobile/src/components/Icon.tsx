import type { ColorValue } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { colors } from '../theme';

// Stroke icons on a 24-unit grid (Lucide-style geometry, drawn here so the app adds no icon font).
const ICONS = {
  home: (
    <>
      <Path d="M3 10.5 12 3l9 7.5" />
      <Path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
    </>
  ),
  dumbbell: (
    <>
      <Path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11" />
    </>
  ),
  chart: (
    <>
      <Path d="M3 3v18h18" />
      <Path d="m7 15 4-4 3 3 6-6" />
    </>
  ),
  apple: (
    <>
      <Path d="M12 7c-1-2-3.5-2.5-5-1.5C4.5 7 4.5 11 6 14.5 7.2 17.3 9 20 10.5 20c.8 0 1-.5 1.5-.5s.7.5 1.5.5C15 20 16.8 17.3 18 14.5c1.5-3.5 1.5-7.5-1-9-1.5-1-4-.5-5 1.5Z" />
      <Path d="M12 7c0-2 1-3.5 3-4" />
    </>
  ),
  sunrise: (
    <>
      <Path d="M12 2v5M4.9 10.9l1.4 1.4M2 18h2M20 18h2M17.7 12.3l1.4-1.4M22 22H2" />
      <Path d="m8 6 4-4 4 4" />
      <Path d="M16 18a4 4 0 0 0-8 0" />
    </>
  ),
  moon: <Path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />,
  user: (
    <>
      <Circle cx={12} cy={8} r={4} />
      <Path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  heart: (
    <Path d="M19.5 12.6 12 20l-7.5-7.4A5 5 0 0 1 12 6a5 5 0 0 1 7.5 6.6Z" />
  ),
  check: <Path d="m5 12 5 5L20 7" />,
  'chevron-right': <Path d="m9 6 6 6-6 6" />,
  'chevron-left': <Path d="m15 6-6 6 6 6" />,
  plus: <Path d="M12 5v14M5 12h14" />,
  close: <Path d="M6 6l12 12M18 6 6 18" />,
  play: <Path d="M7 4v16l13-8Z" />,
  pause: <Path d="M8 5v14M16 5v14" />,
  timer: (
    <>
      <Circle cx={12} cy={13} r={8} />
      <Path d="M12 9v4l2 2M10 2h4" />
    </>
  ),
  swap: <Path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />,
  bolt: <Path d="M13 2 4 14h7l-1 8 9-12h-7Z" />,
  droplet: <Path d="M12 2.7 6.3 9.3a7 7 0 1 0 11.4 0Z" />,
  bell: (
    <>
      <Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <Path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
    </>
  ),
  camera: (
    <>
      <Path d="M3 8a2 2 0 0 1 2-2h2l2-3h6l2 3h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <Circle cx={12} cy={13} r={4} />
    </>
  ),
  bluetooth: <Path d="m7 7 10 10-5 5V2l5 5L7 17" />,
  alert: (
    <>
      <Path d="M12 3 2 20h20Z" />
      <Path d="M12 10v4M12 17h.01" />
    </>
  ),
  info: (
    <>
      <Circle cx={12} cy={12} r={9} />
      <Path d="M12 11v5M12 8h.01" />
    </>
  ),
  settings: (
    <>
      <Circle cx={12} cy={12} r={3} />
      <Path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
    </>
  ),
  list: (
    <>
      <Path d="M9 6h12M9 12h12M9 18h12" />
      <Rect x={3} y={5} width={2} height={2} rx={0.5} />
      <Rect x={3} y={11} width={2} height={2} rx={0.5} />
      <Rect x={3} y={17} width={2} height={2} rx={0.5} />
    </>
  ),
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 22,
  color = colors.text,
  strokeWidth = 2,
}: {
  name: IconName;
  size?: number;
  color?: ColorValue;
  strokeWidth?: number;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {ICONS[name]}
    </Svg>
  );
}
