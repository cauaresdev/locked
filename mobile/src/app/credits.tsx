import { useRouter } from 'expo-router';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '../components/Icon';
import { Divider, Panel, Row, T, TextLink } from '../components/ui';
import { EXERCISE_SOURCES } from '../engine/exerciseMedia';
import { colors, radius, space, themed } from '../theme';

const open = (url: string) => () => { void Linking.openURL(url); };

const FONTS = [
  { name: 'JetBrains Mono', by: 'JetBrains', url: 'https://github.com/JetBrains/JetBrainsMono' },
  { name: 'Barlow Condensed', by: 'Jeremy Tribby', url: 'https://github.com/jpt/barlow' },
];
const OFL = 'https://openfontlicense.org/open-font-license-official-text/';

/** Where the app's images and fonts come from, with the attribution their licenses ask for. */
export default function Credits() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <T variant="display" style={{ flex: 1 }} accessibilityRole="header">Créditos</T>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Fechar" hitSlop={8}
          style={styles.close}>
          <Icon name="close" size={20} color={colors.text} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Panel style={styles.panel}>
          <T variant="title">Fotos dos exercícios</T>
          <T>
            A maioria das fotos vem do free-exercise-db, de domínio público (The Unlicense). Obrigado aos autores do
            projeto.
          </T>
          <TextLink role="link" label="free-exercise-db no GitHub"
            onPress={open('https://github.com/yuhonas/free-exercise-db')} />
        </Panel>

        <Panel style={styles.panel}>
          <T variant="title">Imagens com licença Creative Commons</T>
          <T variant="hint">
            Adaptadas para o app: redimensionadas e com margens acrescentadas. As versões adaptadas das imagens CC BY-SA
            seguem a mesma licença.
          </T>
          {EXERCISE_SOURCES.map((s, i) => (
            <View key={s.source} style={{ gap: 2 }}>
              {i > 0 && <Divider />}
              <T style={{ fontWeight: '600', marginTop: i > 0 ? space.sm : 0 }}>{s.exercise}</T>
              <T variant="hint">{s.credit}</T>
              <Row style={{ gap: space.lg }}>
                <TextLink role="link" label="Original" accessibilityLabel={`Imagem original: ${s.exercise}`}
                  onPress={open(s.source)} />
                <TextLink role="link" label="Licença" accessibilityLabel={`Licença da imagem: ${s.exercise}`}
                  onPress={open(s.license)} />
              </Row>
            </View>
          ))}
        </Panel>

        <Panel style={styles.panel}>
          <T variant="title">Fontes</T>
          {FONTS.map((f) => (
            <Row key={f.name} style={{ justifyContent: 'space-between' }}>
              <T style={{ flex: 1 }}>{f.name} · {f.by}</T>
              <TextLink role="link" label="Projeto" accessibilityLabel={`Projeto da fonte ${f.name}`} onPress={open(f.url)} />
            </Row>
          ))}
          <TextLink role="link" label="SIL Open Font License 1.1" onPress={open(OFL)} />
        </Panel>

        <Panel style={styles.panel}>
          <T variant="title">Software</T>
          <T>
            Feito com React Native, Expo e outras bibliotecas de código aberto, cada uma sob sua própria licença. Os sons
            do metrônomo são gerados pelo próprio app.
          </T>
        </Panel>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  close: {
    width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.surfaceHigh,
    alignItems: 'center', justifyContent: 'center',
  },
  content: { padding: space.lg, paddingTop: 0, gap: space.lg, paddingBottom: space.xxl },
  panel: { gap: space.sm },
}));
