import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, type TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../api/client';
import { setToken } from '../auth';
import { disconnectAllDevices } from '../ble/devices';
import { Button, Field, T } from '../components/ui';
import { clearLocalData, localOwner, storeAthlete } from '../storage/db';
import { colors, space } from '../theme';

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);

  const valid = /\S+@\S+\.\S+/.test(email) && password.length >= 8;

  async function submit() {
    if (!valid || busy) return; // the keyboard's "go" bypasses the disabled button
    setBusy(true);
    setError(null);
    try {
      const auth = mode === 'login' ? await api.login(email.trim(), password) : await api.register(email.trim(), password);
      // Nothing is committed until the profile loads: a half-done login must not leave a token
      // with no athlete (that would land on onboarding for an account that already has one).
      const athlete = auth.athlete_id ? await api.athlete(auth.athlete_id, auth.token) : null;
      // Local data (queues, BLE buffer) belongs to its owner: keep it only for the same athlete.
      const owner = localOwner();
      if (!owner || owner !== auth.athlete_id) {
        await disconnectAllDevices();
        await clearLocalData();
      }
      setToken(auth.token);
      if (athlete) {
        storeAthlete(athlete);
        router.replace('/today');
      } else {
        router.replace('/onboarding');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha de conexão');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <T variant="label">Project Knightfall</T>
          <T variant="hero" style={{ fontSize: 44, lineHeight: 52 }}>KNIGHT{'\n'}FALL</T>
          <T variant="title">{mode === 'login' ? 'Acesso' : 'Novo operador'}</T>
          <Field label="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address"
            autoComplete="email" textContentType="emailAddress" autoCorrect={false} returnKeyType="next"
            submitBehavior="submit" onSubmitEditing={() => passwordRef.current?.focus()} />
          <Field ref={passwordRef} label="Senha (mín. 8)" value={password} onChangeText={setPassword} secureTextEntry
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            textContentType={mode === 'login' ? 'password' : 'newPassword'} autoCorrect={false} returnKeyType="go"
            onSubmitEditing={submit} />
          {error && <T color={colors.amber}>{error}</T>}
          <Button label={busy ? 'Conectando…' : mode === 'login' ? 'Entrar' : 'Criar conta'} onPress={submit}
            disabled={!valid || busy} />
          <Pressable onPress={() => setMode(mode === 'login' ? 'register' : 'login')} accessibilityRole="button"
            style={{ minHeight: 44, justifyContent: 'center' }}>
            <T variant="label" style={{ textAlign: 'center', paddingVertical: space.md }}>
              {mode === 'login' ? 'Criar conta' : 'Já tenho conta'}
            </T>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.void },
  content: { padding: space.lg, gap: space.lg, paddingTop: space.xxl * 2 },
});
