import type { ReactNode } from 'react';
import { Animated, StyleSheet, View, type ImageSourcePropType, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { cardShadow, colors, radius, themed } from '../theme';

/**
 * A card whose background is a photo, darkened toward the bottom so white text on it stays legible
 * in both schemes. Without a photo it is a solid near-black card (the same text still reads on it).
 */
export function PhotoCover({
  source,
  height = 220,
  children,
  style,
  scrollY,
}: {
  source: ImageSourcePropType | null;
  height?: number;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** The screen's scroll offset: the photo then drifts slower than the page (parallax). */
  scrollY?: Animated.Value;
}) {
  const parallax = scrollY
    ? {
        transform: [
          { translateY: scrollY.interpolate({ inputRange: [0, 400], outputRange: [0, PARALLAX], extrapolate: 'clamp' }) },
          { scale: scrollY.interpolate({ inputRange: [-200, 0], outputRange: [1.35, 1], extrapolate: 'clamp' }) },
        ],
      }
    : null;
  return (
    <View style={[styles.card, { minHeight: height }, style]}>
      {source && (
        <>
          <Animated.Image source={source} resizeMode="cover" accessible={false} accessibilityIgnoresInvertColors
            style={[styles.photo, parallax]} />
          <Svg style={StyleSheet.absoluteFill} preserveAspectRatio="none" viewBox="0 0 1 1">
            <Defs>
              <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors.scrim} stopOpacity={0.15} />
                <Stop offset="0.45" stopColor={colors.scrim} stopOpacity={0.45} />
                <Stop offset="1" stopColor={colors.scrim} stopOpacity={0.92} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="1" height="1" fill="url(#fade)" />
          </Svg>
        </>
      )}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

/** Text and icon color on a PhotoCover (always light: the photo is darkened, the fallback is near-black). */
export const ON_PHOTO = '#FFFFFF';
const PARALLAX = 48; // photo overflow above and below the card, used up by the drift
export const ON_PHOTO_MUTED = 'rgba(255,255,255,0.78)';

const styles = themed(() => StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.scrim,
    justifyContent: 'flex-end',
    ...cardShadow,
  },
  content: { padding: 20, gap: 8 },
  photo: { position: 'absolute', left: 0, right: 0, top: -PARALLAX, bottom: 0 },
}));
