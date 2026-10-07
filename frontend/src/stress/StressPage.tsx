import type { ReactNode } from 'react'
import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { splitByModel, tenge, useMoney } from '../money'
import { ArrowUpRight, Bomb, CheckCircle2, PackageX, PlugZap, RotateCcw, Sparkles, Target, Unlink, Users, Wind, XCircle, Zap, type LucideIcon } from 'lucide-react'
import ErrorBoundary from '../ErrorBoundary'
import { load, type Mode, type SimRun } from '../source'
import Plan2D from '../twin/Plan2D'
import Timeline, { clock } from '../twin/Timeline'
import ZonePanel from '../twin/ZonePanel'
import CauseBanner from '../twin/CauseBanner'
import type { ZoneId } from '../twin/layout'
import { useView } from '../twin/store'
import { Card, SourceBadge } from '../ui'

const Scene3D = lazy(() => import('../twin/Scene3D'))

interface Scenario { id: string; name: string; detail: string; zone: ZoneId; window: [number, number] }
interface FaultResult { id: string; name: string; window: [number, number]; loss_alone: number; detected: boolean; delay_min: number | null }
interface Summary {
  ids: string[]; good_base: number; good_fault: number; loss: number; loss_pct: number; plan: number; plan_pct_fault: number; plan_pct_base: number
  oee_base: number; oee_fault: number; downtime_base: number; downtime_fault: number; synergy: number; faults: FaultResult[]; detected: number
}
interface Stats {
  shifts: number; loss_mean: number; loss_range: [number, number]; good_mean: number; plan_pct_mean: number; plan_pct_range: [number, number]
  oee_base_mean: number; oee_fault_mean: number; detect_rate: Record<string, number>; detected_mean: number
}
interface ChaosRun extends SimRun { summary: Summary; stats?: Stats; alerts: { t: number; title: string; text: string }[] }
interface DataResult {
  id: string; name: string; issues: { type: string; text: string }[]; count: number
  detected?: boolean; removed?: number; marked_only?: boolean; clean_ok?: boolean; false_alarm_on_clean_data?: string[]
}

const ICON: Record<string, LucideIcon> = { micro_stops: Zap, conveyor_break: Unlink, filter_clog: Wind, parts_shortage: PackageX, quality_burst: Target, shift_change: Users, power_outage: PlugZap }
function FaultIcon({ id, size = 20, on = true }: { id: string; size?: number; on?: boolean }) {
  const I = ICON[id] ?? Zap
  return <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1 transition ${on ? 'bg-red-600 text-white ring-red-600' : 'bg-red-50 text-red-600 ring-red-100'}`}><I size={size} strokeWidth={2} /></span>
}
const n0 = (x: number) => Math.round(x).toLocaleString('ru-RU')
const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'машина' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'машины' : 'машин')

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: ReactNode; tone?: 'bad' | 'good' }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone === 'bad' ? 'text-red-600' : tone === 'good' ? 'text-emerald-600' : ''}`}>{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  )
}

export default function StressPage() {
  const [list, setList] = useState<{ process: Scenario[]; data: { id: string; name: string }[] } | null>(null)
  const [sel, setSel] = useState<string[]>([])
  const [run, setRun] = useState<ChaosRun | null>(null)
  const [busy, setBusy] = useState(false)
  const [seed, setSeed] = useState(101)
  const [data, setData] = useState<Record<string, DataResult>>({})
  const [view, setView] = useState<'3d' | 'plan'>('plan')
  const margin = useMoney((m) => m.margin)
  const models = useMoney((m) => m.models)
  const t = useView((v) => v.t)
  const [mode, setMode] = useState<Mode>('live')
  const [note, setNote] = useState<string | null>(null)

  // без сервера — записанные прогоны (replay): каждый сбой по отдельности и все вместе
  useEffect(() => { load<NonNullable<typeof list>>('/api/stress/scenarios', '/bundles/stress_scenarios.json').then((r) => { setList(r.data); setMode(r.mode) }).catch(() => {}) }, [])

  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const start = async () => {
    if (!sel.length) return
    setBusy(true); setNote(null)
    try {
      const all = list != null && sel.length === list.process.length
      let r: ChaosRun
      try {
        const res = await load<ChaosRun>(`/api/stress/chaos?ids=${sel.join(',')}&seed=${seed}`, `/bundles/stress_chaos_${all ? 'all' : sel[0]}.json`, 30000)
        if (res.mode === 'replay' && !all && sel.length > 1) throw new Error('нет записи')   // запись есть только для одного сбоя или всех сразу
        r = res.data; setMode(res.mode)
      } catch {
        setNote('Нужно подключение к серверу для этого набора. Без сервера есть записанные прогоны: любой сбой по отдельности или «Выбрать все».')
        return
      }
      setSeed(seed === 105 ? 101 : seed + 1)
      setRun(r)
      const s = r.summary
      useView.getState().setScreen({ stressInfo: `${r.scenario_name}: годных ${s.good_fault} вместо ${s.good_base} (−${s.loss}), замечено ${s.detected} из ${s.faults.length}` })
      const v = useView.getState()
      const first = Math.min(...s.faults.map((f) => f.window[0]))
      v.setPlaying(false); v.setT(Math.max(0, first - 20)); v.select(null); v.setSpeed(60)
      setTimeout(() => { document.getElementById('stress-viewer')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); useView.getState().setPlaying(true) }, 400)
    } finally { setBusy(false) }
  }

  const breakData = async (id: string) => {
    try {
      const r = await load<DataResult>(`/api/stress/data?id=${id}`, `/bundles/stress_data_${id}.json`)
      setData((d) => ({ ...d, [id]: r.data }))
    } catch { /* без сервера и без записи — просто не отмечаем */ }
  }
  const [breakingAll, setBreakingAll] = useState(false)
  const breakAll = async () => {
    setBreakingAll(true)
    try { await Promise.all((list?.data ?? []).map((d) => breakData(d.id))) } finally { setBreakingAll(false) }
  }

  const shownAlerts = useMemo(() => (run ? run.alerts.filter((a) => a.t <= t).slice(-2).reverse() : []), [run, t])
  const goodNow = run ? run.frames[Math.min(Math.floor(t), run.frames.length - 1)]?.good ?? 0 : 0

  if (!list) return <div className="text-sm text-slate-500">Загрузка…</div>
  const s = run?.summary
  const st = run?.stats
  const maxLoss = s ? Math.max(1, ...s.faults.map((f) => f.loss_alone)) : 1

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Испытания: устройте беспредел</h1>
          <p className="text-sm text-slate-500">Отметьте один или несколько сбоев — двойник покажет, сколько машин недособерётся и заметит ли он каждый сбой.</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {list.process.map((sc) => {
          const on = sel.includes(sc.id)
          return (
            <button key={sc.id} onClick={() => toggle(sc.id)} aria-pressed={on}
              className={`flex gap-3 rounded-2xl bg-white p-4 text-left shadow-sm ring-1 transition hover:shadow-md ${on ? 'ring-2 ring-red-500' : 'ring-slate-200'}`}>
              <FaultIcon id={sc.id} on={on} />
              <div className="min-w-0">
                <div className="text-sm font-semibold leading-tight">{sc.name}</div>
                <div className="mt-1 line-clamp-2 text-xs text-slate-500">{sc.detail}</div>
              </div>
            </button>
          )
        })}
      </div>

      {/* панель запуска */}
      <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-white shadow-2xl">
        <span className="text-sm">{sel.length ? <>Выбрано сбоев: <b>{sel.length}</b></> : 'Отметьте сбои выше'}</span>
        <button onClick={() => setSel(list.process.map((p) => p.id))} className="rounded-lg px-2 py-1 text-xs text-slate-300 hover:bg-white/10">Выбрать все</button>
        {sel.length > 0 && <button onClick={() => setSel([])} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-300 hover:bg-white/10"><RotateCcw size={12} />Сбросить</button>}
        <button disabled={!sel.length || busy} onClick={start} className="ml-auto flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold hover:bg-red-500 disabled:opacity-40">
          <Bomb size={16} />{busy ? 'Ломаю линию…' : sel.length > 1 ? 'Устроить беспредел' : 'Устроить сбой'}
        </button>
      </div>

      {note && <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">{note}</div>}

      {run && s && (
        <Card className="scroll-mt-20 overflow-hidden">
          <div id="stress-viewer" />
          {/* итог: прогноз по 40 сменам (честно), ниже — одна смена-пример */}
          {st ? (
            <div className="border-b border-slate-100 p-5">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-sm font-semibold">Прогноз: что будет с такими сбоями</div>
                <div className="text-xs text-slate-500">среднее по {st.shifts} сменам · ниже — одна смена для примера</div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Kpi label="Годных за 2 смены" value={n0(st.good_mean)} sub={`без сбоев было бы ≈ ${n0(st.good_mean + st.loss_mean)} · в примере ${n0(s.good_fault)}`} />
                <Kpi label="Потеряно" value={`−${n0(st.loss_mean)} ${plural(Math.round(st.loss_mean))}`} tone="bad"
                  sub={<>обычно {n0(st.loss_range[0])}–{n0(st.loss_range[1])} · в примере −{n0(s.loss)}<br />≈ {tenge(st.loss_mean * margin)} маржи · {splitByModel(Math.round(st.loss_mean), models, true).map((m) => `${m.model.replace(/^Chevrolet /, '')} ${m.n}`).join(' · ')}</>} />
                <Kpi label="План 240 за 2 смены" value={`${Math.round(st.plan_pct_mean)}%`} sub={`обычно ${Math.round(st.plan_pct_range[0])}–${Math.round(st.plan_pct_range[1])}% · в примере ${Math.round(s.plan_pct_fault)}%`} tone={st.plan_pct_mean < 95 ? 'bad' : undefined} />
                <Kpi label="КПД линии (OEE)" value={`${Math.round(st.oee_fault_mean)}%`} sub={`без сбоев ${Math.round(st.oee_base_mean)}% · в примере ${Math.round(s.oee_fault)}%`} tone={st.oee_fault_mean < 85 ? 'bad' : undefined} />
              </div>
            </div>
          ) : (
            <div className="grid gap-3 border-b border-slate-100 p-5 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi label="Годных за 2 смены" value={`${n0(s.good_fault)}`} sub={`без сбоев было бы ${n0(s.good_base)}`} />
              <Kpi label="Потеряно" value={`−${n0(s.loss)} ${plural(s.loss)}`} sub={`−${Math.round(s.loss_pct)}% выпуска · ≈ ${tenge(s.loss * margin)} маржи`} tone="bad" />
              <Kpi label="План 240 за 2 смены" value={`${Math.round(s.plan_pct_fault)}%`} sub={`без сбоев ${Math.round(s.plan_pct_base)}%`} tone={s.plan_pct_fault < 95 ? 'bad' : undefined} />
              <Kpi label="КПД линии (OEE)" value={`${Math.round(s.oee_fault)}%`} sub={`было ${Math.round(s.oee_base)}%`} tone={s.oee_fault < 85 ? 'bad' : undefined} />
            </div>
          )}

          <div className="grid lg:grid-cols-[1fr_340px]">
            <div className="relative h-[46vh] min-h-[340px] bg-[#f4f5f7] sm:h-[50vh] sm:min-h-[360px]">
              {view === '3d'
                ? <ErrorBoundary key={run.seed + s.ids.join()} fallback={<Plan2D run={run} />}><Suspense fallback={null}><Scene3D run={run} /></Suspense></ErrorBoundary>
                : <Plan2D run={run} />}
              <div className="absolute right-3 top-3 flex rounded-xl bg-white/90 p-1 shadow-sm ring-1 ring-slate-200">
                {(['plan', '3d'] as const).map((v) => <button key={v} onClick={() => setView(v)} className={`rounded-lg px-3 py-1 text-xs font-medium ${view === v ? 'bg-slate-900 text-white' : 'text-slate-500'}`}>{v === '3d' ? '3D' : 'План'}</button>)}
              </div>
              <div className="absolute right-3 top-14 rounded-xl bg-white/95 px-3 py-1.5 text-right shadow-sm ring-1 ring-slate-200">
                <div className="text-[10px] text-slate-500">годных сейчас</div>
                <div className="text-xl font-semibold tabular-nums leading-none">{goodNow}</div>
              </div>
              <CauseBanner run={run} />
              <ZonePanel run={run} />
              <div className="pointer-events-none absolute left-3 top-3 flex w-[calc(100%-8.5rem)] flex-col sm:w-60 gap-1.5 opacity-95">
                {shownAlerts.map((a) => (
                  <div key={a.t + a.title} className="animate-[fadein_.3s_ease] rounded-xl bg-white/95 px-3 py-2 shadow-lg ring-1 ring-red-200 backdrop-blur">
                    <div className="flex items-center gap-2 text-xs font-semibold text-red-600"><span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />{clock(a.t)} · {a.title}</div>
                    <div className="mt-0.5 text-xs text-slate-600">{a.text}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* какой сбой сколько стоит и заметила ли система */}
            <div className="border-t border-slate-100 p-5 lg:border-l lg:border-t-0">
              <div className="flex items-baseline justify-between">
                <div className="text-sm font-semibold">Что стоило дороже всего</div>
                <div className="text-right text-xs text-slate-500">в примере замечено {s.detected} из {s.faults.length}{st && <><br />в среднем {st.detected_mean.toFixed(1).replace('.', ',')} из {s.faults.length}</>}</div>
              </div>
              <ul className="mt-3 space-y-3">
                {s.faults.map((f) => (
                  <li key={f.id}>
                    <div className="flex items-center gap-2 text-sm">
                      {f.detected ? <CheckCircle2 size={15} className="shrink-0 text-emerald-600" /> : <XCircle size={15} className="shrink-0 text-red-500" />}
                      <span className="min-w-0 flex-1 truncate" title={f.name}>{f.name}</span>
                      <span className="shrink-0 tabular-nums font-semibold">−{f.loss_alone}</span>
                    </div>
                    <div className="ml-6 mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-red-500" style={{ width: `${(100 * Math.max(0, f.loss_alone)) / maxLoss}%` }} /></div>
                    <div className="ml-6 mt-0.5 text-[11px] text-slate-400">{f.detected ? `тревога через ${Math.round(f.delay_min ?? 0)} мин` : 'тревоги не было'} · с {clock(f.window[0])}
                      {st && st.detect_rate[f.id] != null && <span className={st.detect_rate[f.id] < 0.95 ? 'text-amber-600' : ''}> · {st.detect_rate[f.id] >= 0.999 ? 'замечается всегда' : `замечен в ${Math.round(st.detect_rate[f.id] * st.shifts)} из ${st.shifts} смен`}</span>}
                    </div>
                  </li>
                ))}
              </ul>
              {s.faults.length > 1 && s.synergy !== 0 && (
                <p className="mt-3 text-xs text-slate-500">
                  {s.synergy > 0 ? `Вместе сбои бьют сильнее: ещё −${s.synergy} сверх суммы по отдельности.` : `Часть потерь совпала по времени: вместе на ${-s.synergy} меньше, чем сумма по отдельности.`}
                </p>
              )}
              <div className="mt-4 flex flex-col gap-2">
                <button onClick={() => useView.getState().ask(`Что произошло в испытании (${s.faults.map((f) => f.name).join(', ')}) и что делать начальнику смены в первую очередь?`)}
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-violet-50 px-3 py-2 text-sm font-medium text-violet-700 hover:bg-violet-100"><Sparkles size={15} />Спросить ИИ, что делать</button>
                <button onClick={() => { const v = useView.getState(); v.setScenario(`cfg:${s.ids.join(',')}|`); v.setTab('twin'); window.scrollTo({ top: 0 }) }}
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"><ArrowUpRight size={15} />Открыть в Двойнике</button>
              </div>
            </div>
          </div>
          <div className="border-t border-slate-100 px-5 py-4"><Timeline run={run} /></div>
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-2 text-[11px] text-slate-400"><span>{run.scenario_name}</span><span className="flex items-center gap-2">{mode === 'replay' && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">офлайн-режим · записанный прогон</span>}<SourceBadge source="sim" /></span></div>
        </Card>
      )}

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-semibold">Сломайте данные</h2>
            <p className="text-sm text-slate-500">Линия работает нормально — ломаются только сигналы с датчиков и связь. Проверяем, что двойник не поверит битым данным. В Двойнике это не показывается: смена там та же.</p>
          </div>
          <button onClick={breakAll} disabled={breakingAll} className="flex shrink-0 items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"><Bomb size={15} />{breakingAll ? 'Ломаю…' : 'Сломать всё'}</button>
        </div>
        {(() => {
          const done = list.data.filter((d) => data[d.id])
          if (!done.length) return null
          const caught = done.filter((d) => data[d.id].detected ?? true).length
          const falseAlarms = new Set(done.flatMap((d) => data[d.id].false_alarm_on_clean_data ?? []))
          return (
            <div className={`mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl px-4 py-3 text-sm ring-1 ${caught === done.length ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-amber-50 text-amber-800 ring-amber-200'}`}>
              <b>Поймано {caught} из {done.length}</b>
              <span>ложных тревог на чистых данных: {falseAlarms.size}</span>
              {done.length < list.data.length && <span className="text-slate-500">проверено {done.length} из {list.data.length}</span>}
            </div>
          )
        })()}
        <div className="mt-3 divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
          {list.data.map((d) => {
            const r = data[d.id]
            const ok = r ? (r.detected ?? true) : false
            const action = !r ? '' : r.marked_only ? 'участок данных помечен — расчёты его не используют' : r.removed ? `убрано битых точек: ${r.removed}` : 'значения исправлены'
            return (
              <div key={d.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm">
                    {r && (ok ? <CheckCircle2 size={15} className="shrink-0 text-emerald-600" /> : <XCircle size={15} className="shrink-0 text-red-500" />)}
                    {d.name}
                  </div>
                  {r && <div className={`mt-0.5 text-xs ${ok ? 'text-slate-500' : 'text-red-600'}`}>{ok ? <>заметил: {r.issues[0]?.text ?? '—'} · {action}</> : 'не заметил'}</div>}
                </div>
                <button onClick={() => breakData(d.id)} className="rounded-lg bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">{r ? 'Ещё раз' : 'Сломать'}</button>
              </div>
            )
          })}
        </div>
      </Card>
      <style>{'@keyframes fadein{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}'}</style>
    </div>
  )
}
