import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import ErrorBoundary from '../ErrorBoundary'
import type { SimRun } from '../source'
import Plan2D from '../twin/Plan2D'
import Timeline, { clock } from '../twin/Timeline'
import ZonePanel from '../twin/ZonePanel'
import CauseBanner from '../twin/CauseBanner'
import type { ZoneId } from '../twin/layout'
import { useView } from '../twin/store'
import { Card, SourceBadge } from '../ui'

const Scene3D = lazy(() => import('../twin/Scene3D'))

interface Scenario { id: string; name: string; detail: string; zone: ZoneId; window: [number, number] }
interface StressRun extends SimRun {
  fault: Scenario
  verdict: { ok: boolean; seen: string; delay_min: number | null }
  alerts: { t: number; title: string; text: string }[]
  compare: { good_fault: number; good_base: number }
}
interface DataResult { id: string; name: string; issues: { type: string; text: string }[]; count: number }

const ICON: Record<string, string> = { micro_stops: '⚡', conveyor_break: '⛓', filter_clog: '🌫', parts_shortage: '📦', quality_burst: '🎯', shift_change: '👷', power_outage: '🔌' }

export default function StressPage() {
  const [list, setList] = useState<{ process: Scenario[]; data: { id: string; name: string }[] } | null>(null)
  const [run, setRun] = useState<StressRun | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [seed, setSeed] = useState(101)
  const [data, setData] = useState<Record<string, DataResult>>({})
  const [view, setView] = useState<'3d' | 'plan'>('3d')
  const t = useView((v) => v.t)

  useEffect(() => { fetch('/api/stress/scenarios').then((r) => r.json()).then(setList).catch(() => {}) }, [])

  const start = async (s: Scenario) => {
    setBusy(s.id)
    try {
      const next = seed === 105 ? 101 : seed + 1
      const r: StressRun = await fetch(`/api/stress/run?id=${s.id}&seed=${seed}`).then((x) => x.json())
      setSeed(next)
      setRun(r)
      const v = useView.getState()
      v.setPlaying(false)
      v.setT(Math.max(0, r.fault.window[0] - 20))   // за 20 мин до сбоя
      v.select(r.fault.zone)
      v.setSpeed(20)
      setTimeout(() => { document.getElementById('stress-viewer')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); useView.getState().setPlaying(true) }, 400)
    } finally { setBusy(null) }
  }

  const breakData = async (id: string) => {
    const r: DataResult = await fetch(`/api/stress/data?id=${id}`).then((x) => x.json())
    setData((d) => ({ ...d, [id]: r }))
  }

  const shownAlerts = useMemo(() => (run ? run.alerts.filter((a) => a.t <= t).slice(-4).reverse() : []), [run, t])
  const after = run ? t >= Math.min(run.fault.window[1], run.fault.window[0] + 90) : false

  if (!list) return <div className="text-sm text-slate-500">Загрузка…</div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Испытания: сломайте линию сами</h1>
        <p className="text-sm text-slate-500">Выберите сбой — и посмотрите, заметит ли его двойник и как быстро.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {list.process.map((s) => (
          <button key={s.id} disabled={!!busy} onClick={() => start(s)}
            className={`rounded-2xl bg-white p-4 text-left shadow-sm ring-1 transition hover:-translate-y-0.5 hover:shadow-md disabled:opacity-50 ${run?.fault.id === s.id ? 'ring-2 ring-slate-900' : 'ring-slate-200'}`}>
            <div className="text-2xl">{ICON[s.id]}</div>
            <div className="mt-2 text-sm font-semibold leading-tight">{s.name}</div>
            <div className="mt-1 line-clamp-2 text-xs text-slate-500">{s.detail}</div>
            <div className="mt-3 text-xs font-medium text-red-600">{busy === s.id ? 'Запускаю…' : 'Устроить сбой →'}</div>
          </button>
        ))}
      </div>

      {run && (
        <Card className="scroll-mt-20 overflow-hidden">
          <div id="stress-viewer" />
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3">
            <span className="text-xl">{ICON[run.fault.id]}</span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{run.fault.name}</div>
              <div className="text-xs text-slate-500">сбой с {clock(run.fault.window[0])} · прогон №{run.seed - 100}</div>
            </div>
            <div className="flex rounded-xl bg-slate-100 p-1">
              {(['3d', 'plan'] as const).map((v) => <button key={v} onClick={() => setView(v)} className={`rounded-lg px-3 py-1 text-xs font-medium ${view === v ? 'bg-white shadow-sm' : 'text-slate-500'}`}>{v === '3d' ? '3D' : 'План'}</button>)}
            </div>
            <SourceBadge source="sim" />
          </div>
          <div className="relative h-[52vh] min-h-[380px] bg-[#f4f5f7]">
            {view === '3d'
              ? <ErrorBoundary key={run.fault.id + run.seed} fallback={<Plan2D run={run} />}><Suspense fallback={null}><Scene3D run={run} /></Suspense></ErrorBoundary>
              : <Plan2D run={run} />}
            <CauseBanner run={run} />
            <ZonePanel run={run} />
            {/* тревоги всплывают по ходу времени */}
            <div className="pointer-events-none absolute left-3 top-3 flex w-72 flex-col gap-2">
              {shownAlerts.map((a) => (
                <div key={a.t + a.title} className="animate-[fadein_.3s_ease] rounded-xl bg-white/95 px-3 py-2 shadow-lg ring-1 ring-red-200 backdrop-blur">
                  <div className="flex items-center gap-2 text-xs font-semibold text-red-600"><span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />{clock(a.t)} · {a.title}</div>
                  <div className="mt-0.5 text-xs text-slate-600">{a.text}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="border-t border-slate-100 px-5 py-4"><Timeline run={run} /></div>
          <div className={`grid gap-4 border-t border-slate-100 px-5 py-4 transition sm:grid-cols-3 ${after ? 'bg-emerald-50/50' : ''}`}>
            <div>
              <div className="text-xs text-slate-500">Система заметила?</div>
              <div className={`mt-1 text-2xl font-semibold ${run.verdict.ok ? 'text-emerald-600' : 'text-red-600'}`}>{run.verdict.ok ? '✓ Да' : '✕ Нет'}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Тревога через</div>
              <div className="mt-1 text-2xl font-semibold">{run.verdict.delay_min != null ? `${Math.round(run.verdict.delay_min)} мин` : '—'}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Годных за 2 смены</div>
              <div className="mt-1 text-2xl font-semibold">{run.compare.good_fault} <span className="text-sm font-normal text-slate-400">без сбоя {run.compare.good_base}</span></div>
            </div>
            <p className="text-sm text-slate-600 sm:col-span-3">{run.verdict.seen}</p>
          </div>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="font-semibold">Сломайте данные</h2>
        <p className="text-sm text-slate-500">Как система реагирует на сбои датчиков и связи.</p>
        <div className="mt-4 divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
          {list.data.map((d) => {
            const r = data[d.id]
            return (
              <div key={d.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm">{d.name}</div>
                  {r && <div className="mt-0.5 text-xs text-emerald-700">✓ поймано: {r.issues[0]?.text ?? '—'}{r.count > 1 ? ` (+${r.count - 1})` : ''}</div>}
                </div>
                <button onClick={() => breakData(d.id)} className="rounded-lg bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">Сломать</button>
              </div>
            )
          })}
        </div>
      </Card>
      <style>{'@keyframes fadein{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}'}</style>
    </div>
  )
}
