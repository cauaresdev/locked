import Storage from 'expo-sqlite/kv-store';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { api } from '../api/client';
import type { Measurements, MeasurementSite } from '../api/types';
import { shortDay } from '../engine/chart';
import { decimal, isoDay, parseDecimal } from '../engine/format';
import { colors, space } from '../theme';
import { ChartCard, LineChart } from './charts';
import { Button, Chip, Field, Panel, Row, T, TextLink } from './ui';

const CACHE_KEY = 'measurements';

function cached(): Measurements | null {
  try {
    const raw = Storage.getItemSync(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Measurements) : null;
  } catch {
    return null;
  }
}

const cm = (v: number) => `${decimal(v)} cm`;

// Fields sit two to a row: they grow to share the row's width.
function pairs<X>(xs: X[]): X[][] {
  return xs.reduce<X[][]>((out, x, i) => (i % 2 ? out[out.length - 1].push(x) : out.push([x]), out), []);
}

/** Tape measurements: the arms, neck and waist tell a bulk from a cut better than the scale does. */
export function MeasurementsCard({ athleteId }: { athleteId: string }) {
  const [data, setData] = useState<Measurements | null>(cached);
  const [site, setSite] = useState<string>('arm');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const show = useCallback((m: Measurements) => {
    setData(m);
    Storage.setItemSync(CACHE_KEY, JSON.stringify(m));
  }, []);

  useEffect(() => {
    api.measurements(athleteId).then(show).catch(() => {});
  }, [athleteId, show]);

  async function save() {
    const values: Record<string, number> = {};
    for (const [k, v] of Object.entries(form)) {
      const n = parseDecimal(v);
      if (n != null) values[k] = n;
    }
    if (Object.keys(values).length === 0) {
      setEditing(false);
      return;
    }
    if (Object.values(values).some((v) => v < 10 || v > 250)) {
      setError('Medidas entre 10 e 250 cm.');
      return;
    }
    try {
      show(await api.putMeasurements(athleteId, { day: isoDay(), values }));
      setForm({});
      setEditing(false);
      setError(null);
    } catch {
      setError('Não salvou: sem conexão.');
    }
  }

  const sites = data?.sites ?? [];
  const current: MeasurementSite | undefined = sites.find((s) => s.site === site);
  const withData = sites.filter((s) => s.latest_cm != null);

  return (
    <Panel style={{ gap: space.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T variant="title">Medidas</T>
        <TextLink label={editing ? 'Cancelar' : 'Registrar hoje'} onPress={() => setEditing(!editing)} />
      </Row>
      {editing ? (
        <View style={{ gap: space.md }}>
          <T variant="hint">Fita métrica de manhã, em jejum, sempre no mesmo ponto. Preencha só o que mediu.</T>
          {pairs(sites).map((pair) => (
            <Row key={pair[0].site} style={{ alignItems: 'flex-end' }}>
              {pair.map((s) => (
                <Field key={s.site} label={`${s.label} (cm)`} value={form[s.site] ?? ''} keyboardType="decimal-pad"
                  placeholder={s.latest_cm != null ? decimal(s.latest_cm) : '—'}
                  onChangeText={(v) => setForm((f) => ({ ...f, [s.site]: v }))} />
              ))}
            </Row>
          ))}
          {error && <T color={colors.warning}>{error}</T>}
          <Button label="Salvar medidas" onPress={save} />
        </View>
      ) : withData.length === 0 ? (
        <T variant="hint">
          Sem medidas ainda. Braço, pescoço, ombros e cintura mostram se o ganho de peso virou músculo.
        </T>
      ) : (
        <View style={{ gap: space.sm }}>
          {withData.map((s) => (
            <Row key={s.site} style={{ justifyContent: 'space-between' }}>
              <T>{s.label}</T>
              <Row style={{ gap: space.sm }}>
                <T variant="metric" style={{ fontSize: 16 }}>{cm(s.latest_cm as number)}</T>
                {s.change_cm != null && s.change_cm !== 0 && (
                  <T variant="label" color={s.change_cm > 0 ? colors.success : colors.textMuted}>
                    {s.change_cm > 0 ? '+' : ''}{decimal(s.change_cm)}
                  </T>
                )}
              </Row>
            </Row>
          ))}
        </View>
      )}
      {!editing && withData.length > 0 && (
        <>
          <Row style={{ flexWrap: 'wrap', gap: space.sm }}>
            {withData.map((s) => (
              <Chip key={s.site} label={s.label} selected={site === s.site} onPress={() => setSite(s.site)} />
            ))}
          </Row>
          {current && current.history.length > 1 && (
            <ChartCard title={current.label}
              table={{ headers: ['Dia', 'Medida'], rows: current.history.map(([d, v]) => [shortDay(d), cm(v)]) }}>
              <LineChart
                series={[{ label: current.label, color: colors.accent, kind: 'line', values: current.history.map(([, v]) => v) }]}
                xLabels={current.history.map(([d]) => shortDay(d))}
                format={(v) => decimal(v, 0)}
              />
            </ChartCard>
          )}
        </>
      )}
    </Panel>
  );
}
