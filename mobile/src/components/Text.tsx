import type { Ref } from 'react';
import {
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
  type TextInputProps,
  type TextProps,
} from 'react-native';

import { withInter } from '../theme';

/** React Native's Text in Inter: the style's fontWeight picks the Inter file (see withInter). */
export function Text({ style, ...props }: TextProps) {
  return <RNText {...props} style={withInter(StyleSheet.flatten(style))} />;
}

/** React Native's TextInput in Inter. */
export function TextInput({ style, ref, ...props }: TextInputProps & { ref?: Ref<RNTextInput> }) {
  return <RNTextInput ref={ref} {...props} style={withInter(StyleSheet.flatten(style))} />;
}
