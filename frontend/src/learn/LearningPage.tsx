import ReactECharts from 'echarts-for-react'
import QRCode from 'qrcode'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { clock } from '../twin/Timeline'
import { Card, SourceBadge } from '../ui'
import { api, pct, type AlertsState, type CalibState, type CameraLog, type ForecastPayload } from './api'

const AX = { color: '#94a3b8', fontSize: 10 }
const num = (x: number, d = 1) => x.toFixed(d).replace('.', ',')

/** Крупная цифра с короткой подписью. */
function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: 'good' | 'bad' | 'muted' }) {
  const color = tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-red-600' : tone === 'muted' ? 'text-slate-400' : 'text-slate-900'
  return (
    <div className="min-w-0">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-3xl font-semibold tracking-tight tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-slate-400">{sub}</div>}
    </div>
  )
}

/** Заголовок блока: номер, название в 2–5 слов, одна строка пояснения. */
function Head({ n, title, sub, badge }: { n: number; title: string; sub: string; badge: 'feedback' | 'forecast' }) {
  return (
    <div className="flex items-start gap-3">
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-900 text-sm font-semibold text-white">{n}</div>
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-semibold leading-tight">{title}</h2>
        <p className="mt-0.5 text-sm text-slate-500">{sub}</p>
      </div>
      <SourceBadge source={badge} />
    </div>
  )
}

/** Подробности — только по клику. */
function More({ children }: { children: ReactNode }) {
  return (
    <details className="group mt-4">
      <summary className="cursor-pointer list-none text-xs font-medium text-slate-400 hover:text-slate-700">
        <span className="group-open:hidden">Как это работает ›</span><span className="hidden group-open:inline">Скрыть</span>
      </summary>
      <div className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-500">{children}</div>
    </details>
  )
}

/* ───────────── 1. Тревоги учатся на ответах людей ───────────── */
function JuryBlock() {
  const [st, setSt] = useState<AlertsState | null>(null)
  const [qr, setQr] = useState('')
  const url = `${window.location.origin}/vote`
  useEffect(() => { QRCode.toDataURL(url, { margin: 1, width: 200, color: { dark: '#0f172a', light: '#ffffff' } }).then(setQr) }, [url])
  useEffect(() => {
    const load = () => api.alerts().then(setSt).catch(() => {})
    load()
    const id = setInterval(load, 2000)
    return () => clearInterval(id)
  }, [])

  const option = useMemo(() => st && ({
    animationDuration: 300,
    grid: { left: 34, right: 8, top: 8, bottom: 22 },
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${Math.round(v)}%` },
    xAxis: { type: 'value', min: 0, axisLabel: { ...AX, showMaxLabel: false }, splitLine: { show: false } },
    yAxis: { type: 'value', min: 0, max: 100, interval: 50, axisLabel: { ...AX, formatter: '{value}%' }, splitLine: { lineStyle: { color: '#eef1f5' } } },
    series: [{ name: 'Точность тревог', type: 'line', step: 'end', showSymbol: false, lineStyle: { color: '#16a34a', width: 2.5 }, areaStyle: { color: 'rgba(22,163,74,0.08)' },
      data: st.curve.map((p) => [p.votes, p.precision == null ? null : 100 * p.precision]) }],
  }), [st])

  if (!st) return <Card className="p-6 text-sm text-slate-500">Загрузка…</Card>
  const up = (st.now.precision ?? 0) > (st.start.precision ?? 0)

  return (
    <Card className="p-6">
      <Head n={1} title="Люди учат тревоги" sub="Ответ «да/нет» — и ложные тревоги исчезают" badge="feedback" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_220px]">
        <div className="min-w-0">
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Точность тревог" value={<>{pct(st.start.precision)} <span className="text-slate-300">→</span> <span className={up ? 'text-emerald-600' : ''}>{pct(st.now.precision)}</span></>} sub="сколько тревог — настоящие" />
            <Stat label="Ложных скрыто" value={st.now.false_suppressed} sub={`из ${st.now.total} проверочных`} tone={st.now.false_suppressed ? 'good' : undefined} />
            <Stat label="Ответов" value={st.votes} sub={st.simulated_votes ? `${st.human_votes} людей · ${st.simulated_votes} симул.` : 'жюри и мастера'} />
          </div>
          {option && st.votes > 0 && <ReactECharts option={option} style={{ height: 120 }} notMerge className="mt-4" />}

          <div className="mt-4 divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
            {st.types.map((t) => {
              const n = t.confirmed + t.rejected
              return (
                <div key={t.type} className={`grid grid-cols-[minmax(0,1fr)_72px_76px_84px] items-center gap-3 px-3 py-2 text-sm ${t.muted ? 'text-slate-400' : ''}`}>
                  <span className="truncate" title={t.title}>{t.title}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <span className={`block h-full rounded-full transition-all duration-500 ${t.muted ? 'bg-slate-300' : 'bg-emerald-500'}`} style={{ width: `${Math.round(t.confirm_rate * 100)}%` }} />
                  </span>
                  <span className="text-right text-xs tabular-nums text-slate-500">{n ? `✓${t.confirmed}  ✕${t.rejected}` : '—'}</span>
                  <span className={`justify-self-end rounded-full px-2 py-0.5 text-[11px] font-medium ${t.muted ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-700'}`}>{t.muted ? 'скрыто' : 'показываем'}</span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex flex-col items-center rounded-2xl bg-slate-50 p-4 text-center ring-1 ring-slate-100">
          <div className="text-sm font-semibold">Ответьте с телефона</div>
          {qr && <img src={qr} alt="QR-код страницы голосования" className="mt-3 h-36 w-36 rounded-lg" />}
          <a href="/vote" target="_blank" rel="noreferrer" className="mt-2 max-w-full truncate text-xs font-medium text-sky-700 underline">{url.replace(/^https?:\/\//, '')}</a>
          <button onClick={() => api.simulate(10).then(setSt)} className="mt-4 w-full rounded-xl bg-white px-3 py-2 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">+10 ответов мастеров</button>
          <button onClick={() => api.reset().then(() => api.alerts().then(setSt))} className="mt-1 w-full rounded-xl px-3 py-1.5 text-xs text-slate-400 hover:text-slate-700">Сбросить</button>
        </div>
      </div>
      <More>
        <p>Для каждого вида тревог система считает, как часто люди отвечают «да». Если вид почти всегда отклоняют — система перестаёт его показывать.</p>
        <p>Спрашивает о том виде, про который знает меньше всего.</p>
        <p>Точность проверяется на отдельных тревогах, которые людям не показывали, по правде симулятора. «+10 ответов мастеров» — симулированные ответы (90% правильных), помечены отдельно.</p>
      </More>
    </Card>
  )
}

/* ───────────── 2. Прогноз выпуска учится сам ───────────── */
function ForecastBlock() {
  const [f, setF] = useState<ForecastPayload | null>(null)
  useEffect(() => { api.forecast().then(setF).catch(() => {}) }, [])
  const option = useMemo(() => {
    if (!f) return null
    const rows = f.timeline.filter((r) => r.mae_served != null)
    const end = rows[rows.length - 1]?.t
    const vline = (t: number, color: string) => ({ xAxis: t, lineStyle: { color, type: 'solid', width: 1.5 }, label: { show: false } })
    const marks = f.events.flatMap((e) => e.type === 'drift' ? [vline(e.t, '#ef4444')] : e.type === 'promotion' ? [vline(e.t, '#16a34a')] : [])
    return {
      animation: false,
      grid: { left: 34, right: 8, top: 10, bottom: 22 },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${num(v ?? 0)} маш.` },
      xAxis: { type: 'value', min: rows[0]?.t, max: end, interval: 960, axisLabel: { ...AX, showMinLabel: false, showMaxLabel: false, formatter: (t: number) => `день ${Math.floor(t / 960) + 1}` }, splitLine: { show: false } },
      yAxis: { type: 'value', axisLabel: AX, splitLine: { lineStyle: { color: '#eef1f5' } } },
      series: [
        { name: 'Что показываем', type: 'line', showSymbol: false, lineStyle: { color: '#16a34a', width: 2.5 }, data: rows.map((r) => [r.t, r.mae_served]),
          markLine: { symbol: 'none', silent: true, data: marks },
          markArea: { silent: true, itemStyle: { color: 'rgba(239,68,68,0.05)' }, data: [[{ xAxis: f.drift_at }, { xAxis: end }]] } },
        { name: 'Без обучения', type: 'line', showSymbol: false, lineStyle: { color: '#f59e0b', width: 1.5 }, data: rows.map((r) => [r.t, r.mae_frozen]) },
        { name: 'Простой', type: 'line', showSymbol: false, lineStyle: { color: '#94a3b8', width: 1.5, type: 'dashed' }, data: rows.map((r) => [r.t, r.mae_naive]) },
        { name: 'TimesFM 3.0', type: 'line', showSymbol: false, lineStyle: { color: '#7c3aed', width: 1.5 }, data: rows.filter((r) => r.mae_tsfm != null).map((r) => [r.t, r.mae_tsfm]) },
      ],
    }
  }, [f])

  if (!f || !option) return <Card className="p-6 text-sm text-slate-500">Считаю 5 дней работы линии…</Card>
  const m = f.multi_seed
  const last = f.timeline[f.timeline.length - 1]
  const promotions = f.events.filter((e) => e.type === 'promotion').length

  return (
    <Card className="p-6">
      <Head n={2} title="Прогноз учится сам" sub="Прогноз на 2 часа → факт → ошибка → дообучение" badge="forecast" />
      <div className="mt-6 grid grid-cols-3 gap-4">
        <Stat label="Ошибка с обучением" value={`−${Math.round(100 * m.gain_vs_frozen)}%`} sub={`чем без обучения · ${m.beats_frozen} из ${m.seeds} прогонов`} tone="good" />
        <Stat label="Сейчас показываем" value={last.serving === 'model' ? `наша ${f.version}` : last.serving === 'tsfm' ? 'TimesFM 3.0' : 'простой'} sub="кто точнее на последних фактах" />
        <Stat label="Модель обновилась" value={`${promotions} раз`} sub="сама, без программиста" />
      </div>
      <ReactECharts option={option} style={{ height: 200 }} notMerge className="mt-4" />
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-emerald-600" />что показываем</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-amber-500" />без обучения</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 border-t border-dashed border-slate-400" />простой «как 2 ч назад»</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-violet-600" />TimesFM 3.0</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-0.5 bg-red-500" />линия изменилась</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-0.5 bg-emerald-600" />новая версия модели</span>
      </div>
      {f.tsfm && (
        <div className="mt-5">
          <div className="mb-2 text-sm font-semibold">Претенденты: готовые ИИ-модели от Google и Amazon</div>
          <div className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
            {[{ model: 'наша модель (самообучение)', mae_after_drift: f.tsfm.baselines.served, ours: true }, ...f.tsfm.models].map((m) => {
              const name: Record<string, string> = { 'timesfm-3.0': 'TimesFM 3.0 · Google', 'timesfm-2.5': 'TimesFM 2.5 · Google', 'chronos-2': 'Chronos-2 · Amazon', 'chronos-2-small': 'Chronos-2 small · Amazon' }
              const tm = m as { model: string; mae_after_drift?: number; ms_per_forecast?: number; admitted?: boolean; error?: string; ours?: boolean }
              return (
                <div key={tm.model} className="grid grid-cols-[minmax(0,1fr)_70px_70px_96px] items-center gap-3 px-3 py-2 text-sm">
                  <span className={`truncate ${tm.ours ? 'font-semibold' : ''}`}>{name[tm.model] ?? tm.model}</span>
                  <span className="text-right tabular-nums">{tm.mae_after_drift != null ? num(tm.mae_after_drift) : '—'}</span>
                  <span className="text-right text-xs tabular-nums text-slate-400">{tm.ms_per_forecast != null ? `${tm.ms_per_forecast} мс` : ''}</span>
                  <span className={`justify-self-end rounded-full px-2 py-0.5 text-[11px] font-medium ${tm.ours ? 'bg-slate-100 text-slate-600' : tm.error ? 'bg-slate-100 text-slate-400' : tm.admitted ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    {tm.ours ? 'своя' : tm.error ? 'не запустилась' : tm.admitted ? 'в отборе' : 'не точнее'}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">ошибка, машин за 2 ч после смены режима · среднее по {f.tsfm.seeds} прогонам · простой прогноз — {num(f.tsfm.baselines.naive)} · считалось на {f.tsfm.device === 'cuda' ? 'видеокарте' : 'процессоре'}</div>
        </div>
      )}
      <More>
        <p>Претенденты (TimesFM, Chronos) не дообучаются — они видят только свежую историю выпуска (zero-shot). Если претендент точнее на последних фактах, система может сделать его основным — по тому же правилу, что и свои версии.</p>
        <p>Каждые 30 минут система записывает прогноз годных машин на 2 часа вперёд — до того, как они прошли. Когда приходит факт, считает ошибку и дообучается.</p>
        <p>На 3-й день окраска скрыто деградирует (красная зона). Система замечает это сама и переключается на более точную версию модели.</p>
        <p>Защита: прогноз модели показывается, только если на последних фактах она точнее простого прогноза. Пока модель учится — показываем простой.</p>
        <p>Цифры — среднее по {m.seeds} разным прогонам симуляции: ошибка {num(m.mae_after_drift.served)} машины против {num(m.mae_after_drift.frozen)} без обучения и {num(m.mae_after_drift.naive)} у простого прогноза.</p>
        <ul className="mt-1 space-y-0.5">
          {f.events.filter((e) => e.type === 'drift' || e.type === 'promotion').map((e, i) => (
            <li key={i}><span className={e.type === 'drift' ? 'text-red-500' : 'text-emerald-600'}>●</span> день {Math.floor(e.t / 960) + 1}, {clock(e.t % 960)} — {e.text}</li>
          ))}
        </ul>
      </More>
    </Card>
  )
}

/* ───────────── 3. Брак окраски: ввод человека ───────────── */
function CalibBlock() {
  const [st, setSt] = useState<CalibState | null>(null)
  const [produced, setProduced] = useState(118)
  const [defects, setDefects] = useState(6)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<CameraLog[]>([])
  const [streaming, setStreaming] = useState(false)
  useEffect(() => { api.calib().then(setSt).catch(() => {}); api.camera().then((c) => setLog(c.log)).catch(() => {}) }, [])
  const runCamera = async () => {
    setStreaming(true)
    try { for (let i = 0; i < 3; i++) { const c = await api.cameraDemo(20); setLog(c.log); setSt(c.calib) } } finally { setStreaming(false) }
  }
  if (!st) return <Card className="p-6 text-sm text-slate-500">Загрузка…</Card>
  const c = st.current
  const pos = (x: number) => `${Math.min(100, (x / 0.1) * 100)}%`
  const submit = async () => { setBusy(true); try { setSt(await api.calibAdd(produced, defects, 'жюри')) } finally { setBusy(false) } }

  return (
    <Card className="p-6">
      <Head n={3} title="Уточните брак окраски" sub="Введите брак за смену — двойник пересчитается" badge="feedback" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_260px]">
        <div className="min-w-0">
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Брак окраски" value={pct(c.mean, 1)} sub={`точно от ${pct(c.lo90, 1)} до ${pct(c.hi90, 1)}`} tone={c.mean > st.norm ? 'bad' : 'good'} />
            <Stat label="Переделок за смену" value={num(c.mean * 120)} sub={`при норме — ${num(st.norm * 120)}`} />
            <Stat label="Годных за смену" value={Math.round(c.forecast.good_per_shift)} sub="прогноз двойника" />
          </div>
          {/* шкала: норма и «вилка» оценки */}
          <div className="relative mt-6 h-3 rounded-full bg-slate-100">
            <div className="absolute inset-y-0 rounded-full bg-red-200 transition-all duration-700" style={{ left: pos(c.lo90), width: `calc(${pos(c.hi90)} - ${pos(c.lo90)})` }} />
            <div className="absolute -inset-y-1 w-1 rounded-full bg-red-600 transition-all duration-700" style={{ left: pos(c.mean) }} />
            <div className="absolute -inset-y-1.5 w-0.5 bg-emerald-600" style={{ left: pos(st.norm) }} />
          </div>
          <div className="relative mt-1.5 h-4 text-[11px]">
            <span className="absolute -translate-x-1/2 text-emerald-700" style={{ left: pos(st.norm) }}>норма 2%</span>
            <span className="absolute right-0 text-slate-400">10%</span>
          </div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-500">Выпущено
              <input type="number" min={1} value={produced} onChange={(e) => setProduced(Number(e.target.value))} className="mt-1 w-full rounded-lg bg-white px-3 py-2 text-base font-semibold ring-1 ring-slate-200" /></label>
            <label className="text-xs text-slate-500">С браком
              <input type="number" min={0} value={defects} onChange={(e) => setDefects(Number(e.target.value))} className="mt-1 w-full rounded-lg bg-white px-3 py-2 text-base font-semibold ring-1 ring-slate-200" /></label>
          </div>
          <button disabled={busy || defects > produced || produced < 1} onClick={submit} className="mt-3 w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Пересчитываю…' : 'Обучить двойник'}</button>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
            <span>версия v{c.version}</span>
            <button onClick={() => api.calibUndo().then(setSt)} className="hover:text-slate-700">↶ откатить</button>
          </div>
        </div>
      </div>
      {/* Камера контроля ЛКП: двойник учится сам, без человека */}
      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
        <span className={`grid h-9 w-9 place-items-center rounded-full ${streaming ? 'animate-pulse bg-red-100' : 'bg-white ring-1 ring-slate-200'}`} aria-hidden>📷</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Камера контроля окраски</div>
          <div className="text-xs text-slate-500">{st.camera.seen ? `проверено ${st.camera.seen} кузовов · ${st.camera.defects} с дефектом · двойник учится сам` : 'каждый кузов с камеры сразу уточняет брак'}</div>
        </div>
        <div className="flex gap-1">
          {log.slice(0, 16).reverse().map((e, i) => <span key={i} title={e.defect ? `${e.body_id}: ${e.defect_class}` : `${e.body_id}: без дефекта`} className={`h-5 w-1.5 rounded-sm ${e.defect ? 'bg-red-500' : 'bg-emerald-400'}`} />)}
        </div>
        <button disabled={streaming} onClick={runCamera} className="rounded-xl bg-white px-3 py-2 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100 disabled:opacity-50">{streaming ? 'Идёт поток…' : '▶ Поток камеры (демо)'}</button>
      </div>
      <More>
        <p>Камера: принимаем события любой камеры контроля ЛКП в открытом формате (POST /api/learn/camera/event). Идея — из кейса Allur Challenge 2025 (распознавание дефектов окраски по фото): камера находит дефект, двойник считает, во что он обходится. С их решением мы не интегрированы — совместимы по формату. Демо-поток — симуляция.</p>
        <p>Старт — 2 дня брака окраски из ТЗ (10 дефектов на 231). Каждый ввод добавляется к данным: оценка уточняется, «вилка» сужается, двойник пересчитывает выпуск.</p>
        <p>Вероятность, что брак выше нормы 2%: {c.p_above_norm > 0.99 ? 'больше 99%' : pct(c.p_above_norm)}.</p>
        <ul className="mt-1 space-y-0.5">{st.history.slice(-5).reverse().map((h) => <li key={h.version}>v{h.version} · {h.trigger} → {pct(h.mean, 1)}</li>)}</ul>
      </More>
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
