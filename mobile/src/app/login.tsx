import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../api/client';
import { setToken } from '../auth';
import { Button, Field, T } from '../components/ui';
import { clearLocalData, storeAthlete, storedAthlete } from '../storage/db';
import { colors, space } from '../theme';

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = /\S+@\S+\.\S+/.test(email) && password.length >= 8;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const auth = mode === 'login' ? await api.login(email.trim(), password) : await api.register(email.trim(), password);
      setToken(auth.token);
      // Data left from a previous session belongs to that athlete: keep it only for the same one.
      const previous = storedAthlete();
      if (previous && previous.id !== auth.athlete_id) await clearLocalData();
      const athlete = auth.athlete_id ? await api.athlete(auth.athlete_id) : null;
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
            autoComplete="email" textContentType="emailAddress" />
          <Field label="Senha (mín. 8)" value={password} onChangeText={setPassword} secureTextEntry
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          {error && <T color={colors.amber}>{error}</T>}
          <Button label={busy ? 'Conectando…' : mode === 'login' ? 'Entrar' : 'Criar conta'} onPress={submit}
            disabled={!valid || busy} />
          <Pressable onPress={() => setMode(mode === 'login' ? 'register' : 'login')} accessibilityRole="button">
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
