import ReactECharts from 'echarts-for-react'
import QRCode from 'qrcode'
import { useEffect, useMemo, useState } from 'react'
import { clock } from '../twin/Timeline'
import { Card, SourceBadge } from '../ui'
import { api, pct, type AlertsState, type CalibState, type ForecastPayload } from './api'

const AX = { color: '#94a3b8', fontSize: 10 }

function Big({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'good' | 'muted' }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-0.5 text-3xl font-semibold tracking-tight ${tone === 'good' ? 'text-emerald-600' : tone === 'muted' ? 'text-slate-400' : ''}`}>{value}</div>
      {note && <div className="text-xs text-slate-500">{note}</div>}
    </div>
  )
}

/** 1. Жюри учит систему: ответы «да/нет» → точность тревог растёт. */
function JuryBlock() {
  const [st, setSt] = useState<AlertsState | null>(null)
  const [qr, setQr] = useState('')
  const url = `${window.location.origin}/vote`
  useEffect(() => { QRCode.toDataURL(url, { margin: 1, width: 220, color: { dark: '#0f172a', light: '#ffffff' } }).then(setQr) }, [url])
  useEffect(() => {
    const load = () => api.alerts().then(setSt).catch(() => {})
    load()
    const id = setInterval(load, 2000)
    return () => clearInterval(id)
  }, [])

  const option = useMemo(() => st && ({
    animationDuration: 400,
    grid: { left: 36, right: 12, top: 16, bottom: 26 },
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${Math.round(v)}%` },
    xAxis: { type: 'value', min: 0, name: 'ответов', nameLocation: 'end', nameTextStyle: AX, axisLabel: AX, splitLine: { show: false } },
    yAxis: { type: 'value', min: 0, max: 100, axisLabel: { ...AX, formatter: '{value}%' }, splitLine: { lineStyle: { color: '#eef1f5' } } },
    series: [
      { name: 'Точность тревог', type: 'line', showSymbol: false, smooth: true, lineStyle: { color: '#16a34a', width: 2.5 }, areaStyle: { color: 'rgba(22,163,74,0.08)' },
        data: st.curve.map((p) => [p.votes, p.precision == null ? null : 100 * p.precision]) },
      { name: 'Найдено реальных проблем', type: 'line', showSymbol: false, smooth: true, lineStyle: { color: '#94a3b8', width: 1.5, type: 'dashed' },
        data: st.curve.map((p) => [p.votes, p.recall == null ? null : 100 * p.recall]) },
    ],
  }), [st])

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Люди учат систему: «это реальная проблема?»</h2>
          <p className="text-sm text-slate-500">Каждый ответ «да/нет» сразу меняет модель: виды тревог, которые люди отклоняют, система приглушает. Спрашивает о том, что знает хуже всего.</p>
        </div>
        <SourceBadge source="feedback" />
      </div>
      {!st ? <div className="mt-4 text-sm text-slate-500">Загрузка…</div> : (
        <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_260px]">
          <div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Big label="Точность тревог" value={pct(st.now.precision)} note={`было ${pct(st.start.precision)}`} tone={st.now.precision && st.start.precision && st.now.precision > st.start.precision ? 'good' : undefined} />
              <Big label="Ответов людей" value={String(st.human_votes)} note={st.simulated_votes ? `+${st.simulated_votes} симулированных` : 'жюри и мастера'} />
              <Big label="Ложных отсеяно" value={String(st.now.false_suppressed)} note={`из ${st.now.total} проверочных`} />
              <Big label="Модель" value={st.version} note="версия после каждого ответа" />
            </div>
            {option && <ReactECharts option={option} style={{ height: 200 }} notMerge className="mt-3" />}
            <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
              {st.types.map((t) => (
                <div key={t.type} className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs ring-1 transition ${t.muted ? 'bg-slate-50 text-slate-400 ring-slate-100' : 'bg-white text-slate-700 ring-slate-200'}`}>
                  <span className={`flex-1 ${t.muted ? 'line-through' : ''}`}>{t.title}</span>
                  <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100"><span className={`block h-full rounded-full transition-all duration-500 ${t.muted ? 'bg-slate-300' : 'bg-emerald-500'}`} style={{ width: `${Math.round(t.confirm_rate * 100)}%` }} /></span>
                  <span className="w-20 text-right tabular-nums">{t.confirmed + t.rejected ? `да ${t.confirmed} · нет ${t.rejected}` : 'нет ответов'}</span>
                  {t.muted && <span className="text-[10px] font-medium uppercase text-slate-400">приглушено</span>}
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-400">Точность считаем на отдельных тревогах, которые людям не показывали, по правде эмулятора. Обратная сторона: модель становится осторожнее и может пропустить часть реальных проблем — пунктир.</p>
          </div>
          <div className="flex flex-col items-center rounded-2xl bg-slate-50 p-4 text-center ring-1 ring-slate-100">
            <div className="text-sm font-semibold">Ответьте с телефона</div>
            {qr && <img src={qr} alt="QR-код страницы голосования" className="mt-2 h-40 w-40 rounded-lg" />}
            <a href="/vote" target="_blank" rel="noreferrer" className="mt-2 break-all text-xs font-medium text-sky-700 underline">{url}</a>
            <div className="mt-4 flex w-full flex-col gap-2">
              <button onClick={() => api.simulate(10).then(setSt)} className="rounded-xl bg-white px-3 py-2 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">+10 ответов симулированных мастеров</button>
              <button onClick={() => api.reset().then(() => api.alerts().then(setSt))} className="rounded-xl px-3 py-2 text-xs text-slate-400 hover:text-slate-700">Сбросить обучение</button>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

/** 2. Прогноз учится сам: записан до факта, сверен с фактом, модель дообучилась. */
function ForecastBlock() {
  const [f, setF] = useState<ForecastPayload | null>(null)
  useEffect(() => { api.forecast().then(setF).catch(() => {}) }, [])
  const option = useMemo(() => {
    if (!f) return null
    const rows = f.timeline.filter((r) => r.mae_champion != null)
    const day = (t: number) => `д${Math.floor(t / 960) + 1} ${clock(t % 960)}`
    const marks = f.events.filter((e) => e.type !== 'freeze').map((e) => ({ xAxis: e.t, label: { show: true, formatter: e.type === 'drift' ? 'дрейф' : 'новая версия', color: e.type === 'drift' ? '#dc2626' : '#16a34a', fontSize: 10 }, lineStyle: { color: e.type === 'drift' ? '#fca5a5' : '#86efac', type: 'solid' } }))
    return {
      animation: false,
      grid: { left: 36, right: 12, top: 28, bottom: 26 },
      legend: { top: 0, right: 0, itemWidth: 14, itemHeight: 3, textStyle: { color: '#64748b', fontSize: 11 } },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${v?.toFixed(1)} маш.` },
      xAxis: { type: 'value', min: rows[0]?.t, max: rows[rows.length - 1]?.t, axisLabel: { ...AX, formatter: day }, splitLine: { show: false } },
      yAxis: { type: 'value', name: 'ошибка, машин', nameTextStyle: AX, axisLabel: AX, splitLine: { lineStyle: { color: '#eef1f5' } } },
      series: [
        { name: 'Самообучение', type: 'line', showSymbol: false, lineStyle: { color: '#16a34a', width: 2.5 }, data: rows.map((r) => [r.t, r.mae_champion]),
          markLine: { symbol: 'none', silent: true, data: marks },
          markArea: { silent: true, itemStyle: { color: 'rgba(239,68,68,0.05)' }, data: [[{ xAxis: f.drift_at }, { xAxis: rows[rows.length - 1]?.t }]] } },
        { name: 'Без обучения', type: 'line', showSymbol: false, lineStyle: { color: '#f59e0b', width: 1.5 }, data: rows.map((r) => [r.t, r.mae_frozen]) },
        { name: '«Как в прошлые 2 ч»', type: 'line', showSymbol: false, lineStyle: { color: '#94a3b8', width: 1.5, type: 'dashed' }, data: rows.map((r) => [r.t, r.mae_naive]) },
      ],
    }
  }, [f])

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Прогноз выпуска учится сам</h2>
          <p className="text-sm text-slate-500">Каждые 30 мин система записывает прогноз годных на 2 часа вперёд — до факта. Пришёл факт → ошибка → модель дообучается.</p>
        </div>
        <SourceBadge source="forecast" />
      </div>
      {!f || !option ? <div className="mt-4 text-sm text-slate-500">Считаю 5 дней потока…</div> : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Big label="Ошибка меньше, чем без обучения" value={`−${Math.round(100 * f.multi_seed.gain_vs_frozen)}%`} note={`в ${f.multi_seed.beats_frozen} из ${f.multi_seed.seeds} прогонов`} tone="good" />
            <Big label="Ошибка самообучения" value={f.multi_seed.mae_after_drift.champion.toFixed(1).replace('.', ',')} note="машин за 2 ч, после смены режима" />
            <Big label="«Как в прошлые 2 ч»" value={f.multi_seed.mae_after_drift.naive.toFixed(1).replace('.', ',')} note={`обогнали в ${f.multi_seed.beats_naive} из ${f.multi_seed.seeds}`} tone="muted" />
            <Big label="Текущая модель" value={f.version} note={`${f.events.filter((e) => e.type === 'promotion').length} автозамены`} />
          </div>
          <ReactECharts option={option} style={{ height: 230 }} notMerge className="mt-3" />
          <ul className="mt-2 space-y-1 text-xs text-slate-500">
            {f.events.filter((e) => e.type !== 'freeze').map((e, i) => (
              <li key={i}><span className={e.type === 'drift' ? 'text-red-600' : 'text-emerald-600'}>●</span> день {Math.floor(e.t / 960) + 1}, {clock(e.t % 960)} — {e.text}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-400">{f.note} Красная зона — после скрытой деградации окраски. Сравнение на 10 разных прогонах, а не на одном удачном.</p>
        </>
      )}
    </Card>
  )
}

/** 3. Калибровка: человек вводит брак за смену → оценка и прогноз двойника обновляются. */
function CalibBlock() {
  const [st, setSt] = useState<CalibState | null>(null)
  const [produced, setProduced] = useState(118)
  const [defects, setDefects] = useState(6)
  const [who, setWho] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.calib().then(setSt).catch(() => {}) }, [])
  if (!st) return <Card className="p-6 text-sm text-slate-500">Загрузка…</Card>
  const c = st.current
  const scale = (x: number) => `${Math.min(100, (x / 0.12) * 100)}%`
  const rework = c.mean * 120
  const reworkNorm = st.norm * 120

  const submit = async () => {
    setBusy(true)
    try { setSt(await api.calibAdd(produced, defects, who)) } finally { setBusy(false) }
  }

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Уточните брак окраски — двойник пересчитается</h2>
          <p className="text-sm text-slate-500">Старт — 2 дня из ТЗ. Каждый ввод сужает «вилку» и меняет прогноз двойника.</p>
        </div>
        <SourceBadge source="feedback" />
      </div>
      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_300px]">
        <div>
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-semibold tracking-tight">{pct(c.mean, 1)}</span>
            <span className="text-sm text-slate-500">брак окраски · вилка {pct(c.lo90, 1)}–{pct(c.hi90, 1)} (90%)</span>
          </div>
          <div className="relative mt-4 h-8 rounded-full bg-slate-100">
            <div className="absolute inset-y-0 rounded-full bg-amber-200 transition-all duration-700" style={{ left: scale(c.lo90), width: `calc(${scale(c.hi90)} - ${scale(c.lo90)})` }} />
            <div className="absolute inset-y-0 w-1 rounded-full bg-amber-600 transition-all duration-700" style={{ left: scale(c.mean) }} />
            <div className="absolute inset-y-[-4px] w-0.5 bg-emerald-600" style={{ left: scale(st.norm) }} title="норма 2%" />
            <div className="absolute -bottom-5 text-[10px] text-emerald-700" style={{ left: scale(st.norm) }}>норма 2%</div>
          </div>
          <div className="mt-8 grid grid-cols-3 gap-4">
            <Big label="Вероятность, что выше нормы" value={c.p_above_norm > 0.99 ? "> 99%" : c.p_above_norm < 0.01 ? "< 1%" : pct(c.p_above_norm)} />
            <Big label="Переделок за смену" value={rework.toFixed(1).replace('.', ',')} note={`при норме — ${reworkNorm.toFixed(1).replace('.', ',')}`} />
            <Big label="Годных за смену (двойник)" value={String(Math.round(c.forecast.good_per_shift))} note={`от ${Math.round(c.forecast.lo)} до ${Math.round(c.forecast.hi)}`} />
          </div>
          <ul className="mt-4 space-y-1 text-xs text-slate-500">
            {st.history.slice(-4).reverse().map((h) => <li key={h.version}>v{h.version} · {h.trigger} → {pct(h.mean, 1)}</li>)}
          </ul>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
          <div className="text-sm font-semibold">Данные за смену</div>
          <label className="mt-3 block text-xs text-slate-500">Выпущено кузовов
            <input type="number" min={1} value={produced} onChange={(e) => setProduced(Number(e.target.value))} className="mt-1 w-full rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-slate-200" /></label>
          <label className="mt-2 block text-xs text-slate-500">Из них с браком
            <input type="number" min={0} value={defects} onChange={(e) => setDefects(Number(e.target.value))} className="mt-1 w-full rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-slate-200" /></label>
          <label className="mt-2 block text-xs text-slate-500">Кто ввёл
            <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="например, жюри" className="mt-1 w-full rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-slate-200" /></label>
          <button disabled={busy || defects > produced} onClick={submit} className="mt-3 w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Пересчитываю…' : 'Обучить двойник'}</button>
          <button onClick={() => api.calibUndo().then(setSt)} className="mt-2 w-full text-xs text-slate-400 hover:text-slate-700">Откатить последний ввод</button>
        </div>
      </div>
    </Card>
  )
}

export default function LearningPage() {
  return (
    <div className="space-y-6">
      <JuryBlock />
      <ForecastBlock />
      <CalibBlock />
    </div>
  )
}
