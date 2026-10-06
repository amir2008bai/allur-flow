import { Suspense, lazy, useEffect, useState } from 'react'
import ErrorBoundary from './ErrorBoundary'
import Dashboard from './twin/Dashboard'
import Flow2D from './twin/Flow2D'
import Plan2D from './twin/Plan2D'
import CauseBanner from './twin/CauseBanner'
import Futures from './twin/Futures'
import { ZONES } from './twin/layout'
import Timeline from './twin/Timeline'
import ZonePanel from './twin/ZonePanel'
import { useView } from './twin/store'

const Scene3D = lazy(() => import('./twin/Scene3D'))
import { load, type Mode, type SimMeta, type SimRun, type WhatIf } from './source'
import { Card, SourceBadge, fmt } from './ui'

const STATE_COLOR: Record<string, string> = { working: 'bg-slate-700', starved: 'bg-slate-200', blocked: 'bg-amber-300', down: 'bg-red-400' }
const STATE_RU: Record<string, string> = { working: 'работает', starved: 'ждёт кузов', blocked: 'некуда отдать', down: 'стоит' }

function Tile({ label, value, unit, note, tone }: { label: string; value: string; unit?: string; note: string; tone?: 'bad' | 'warn' }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        {tone && <span className={`h-2 w-2 rounded-full ${tone === 'bad' ? 'bg-red-500' : 'bg-amber-500'}`} />}
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1"><span className="text-4xl font-semibold tracking-tight">{value}</span>{unit && <span className="text-sm text-slate-500">{unit}</span>}</div>
      <div className="mt-1 text-xs text-slate-500">{note}</div>
    </Card>
  )
}

function TourButton() {
  const touring = useView((v) => v.touring)
  const setTouring = useView((v) => v.setTouring)
  useEffect(() => {
    if (!touring) return
    const order = ZONES.map((z) => z.id)
    let i = 0
    useView.getState().select(order[0])
    const id = setInterval(() => {
      i += 1
      if (i >= order.length) { useView.getState().select(null); setTouring(false); return }
      useView.getState().select(order[i])
    }, 3200)
    return () => clearInterval(id)
  }, [touring, setTouring])
  return (
    <button onClick={() => { if (touring) useView.getState().select(null); setTouring(!touring) }}
      className="absolute left-3 top-16 rounded-xl bg-white/90 px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 backdrop-blur hover:text-slate-900">
      {touring ? '■ Стоп' : '▶ Обзор линии'}
    </button>
  )
}

export default function TwinPage() {
  const [meta, setMeta] = useState<SimMeta | null>(null)
  const scenario = useView((v) => v.scenario)
  const setScenario = useView((v) => v.setScenario)
  const [run, setRun] = useState<SimRun | null>(null)
  const [whatif, setWhatif] = useState<WhatIf | null>(null)
  const [mode, setMode] = useState<Mode>('live')
  const view = useView((v) => v.view)
  const [futures, setFutures] = useState<string | null>(null)
  const setView = useView((v) => v.setView)

  useEffect(() => { load<SimMeta>('/api/sim/meta', '/bundles/meta.json').then((r) => setMeta(r.data)) }, [])
  useEffect(() => {
    setRun(null); setWhatif(null); setFutures(null); useView.getState().setPlaying(false)
    load<SimRun>(`/api/sim/run?scenario=${scenario}&seed=7`, `/bundles/run_${scenario}.json`).then((r) => { setRun(r.data); setMode(r.mode) })
    load<WhatIf>(`/api/sim/whatif?scenario=${scenario}&reps=20`, `/bundles/whatif_${scenario}.json`, 15000).then((r) => setWhatif(r.data))
  }, [scenario])

  if (!meta) return <div className="text-sm text-slate-500">Загрузка…</div>
  const name = Object.fromEntries(meta.stations.map((s) => [s.id, s.name]))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {meta.scenarios.map((s) => (
          <button key={s.id} onClick={() => setScenario(s.id)}
            className={`rounded-xl px-4 py-2 text-sm ring-1 transition ${scenario === s.id ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'}`}>
            {s.name}
          </button>
        ))}
        <button onClick={() => { setFutures('paint_service'); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700">◐ Два будущих рядом</button>
        <span className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          <SourceBadge source="sim" /> 2 смены · {mode === 'live' ? 'сервер' : 'записанный прогон'}
        </span>
      </div>

      {!run ? <div className="text-sm text-slate-500">Считаю симуляцию…</div> : (
        <>
          {futures && <Futures scenario={scenario} action={futures} onClose={() => setFutures(null)} />}
          {!futures && <Card className="overflow-hidden">
            <div className="relative h-[60vh] min-h-[420px] bg-[#f4f5f7]">
              {view === '3d'
                ? <ErrorBoundary key={scenario} fallback={<div className="grid h-full place-items-center text-sm text-slate-500">3D недоступно на этом устройстве — откройте 2D-схему</div>}><Suspense fallback={<div className="grid h-full place-items-center text-sm text-slate-500">Загружаю 3D…</div>}><Scene3D run={run} /></Suspense></ErrorBoundary>
                : view === 'plan' ? <Plan2D run={run} /> : <Flow2D run={run} />}
              <div className="absolute left-3 top-3 flex rounded-xl bg-white/90 p-1 shadow-sm ring-1 ring-slate-200 backdrop-blur">
                {(['3d', 'plan', 'flow'] as const).map((v) => (
                  <button key={v} onClick={() => setView(v)} className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${view === v ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'}`}>
                    {v === '3d' ? '3D' : v === 'plan' ? 'План' : 'Схема'}
                  </button>
                ))}
              </div>
              {view === '3d' && <TourButton />}
              <div className="absolute bottom-3 left-3 flex flex-wrap gap-3 rounded-xl bg-white/90 px-3 py-2 text-[11px] text-slate-600 shadow-sm ring-1 ring-slate-200 backdrop-blur">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-green-500" />работает / поток идёт</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-500" />стоит</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400" />некуда отдать</span>
                <span className="flex items-center gap-1.5"><span className="text-amber-500">◆</span>узкое место</span>
              </div>
              <CauseBanner run={run} />
              <ZonePanel run={run} />
            </div>
            <div className="border-t border-slate-100 px-5 py-4"><Timeline run={run} /></div>
          </Card>}

          <Dashboard run={run} />

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Годных машин за смену" value={fmt(Math.round(run.kpi.good_per_shift))} unit={`/ ${run.kpi.plan_per_shift} план`}
              note="считаем на выходе ОТК" tone={run.kpi.good_per_shift < run.kpi.plan_per_shift * 0.95 ? 'bad' : undefined} />
            <Tile label="Главное узкое место" value={name[run.bottleneck.top]} note={`ограничивает поток ${Math.round(100 * (run.bottleneck.sole[run.bottleneck.top] + run.bottleneck.shifting[run.bottleneck.top]))}% времени`} tone="warn" />
            <Tile label="Брак окраски" value={fmt(Math.round(run.kpi.defect_pct.paint * 10) / 10)} unit="%" note="норма 2%" tone={run.kpi.defect_pct.paint > 2 ? 'bad' : undefined} />
            <Tile label="OEE линии" value={fmt(Math.round(run.kpi.oee_pct))} unit="%" note="цель 85% · при допущенном цикле" tone={run.kpi.oee_pct < 85 ? 'warn' : undefined} />
          </div>

          <Card className="p-5">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="font-semibold">Что делает каждый участок</h2>
              <div className="flex gap-3 text-xs text-slate-500">
                {Object.entries(STATE_RU).map(([k, v]) => <span key={k} className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm ${STATE_COLOR[k]}`} />{v}</span>)}
              </div>
            </div>
            <div className="space-y-3">
              {meta.stations.map((s) => {
                const sh = run.kpi.state_shares[s.id]
                const isTop = run.bottleneck.top === s.id
                return (
                  <div key={s.id} className="flex items-center gap-3">
                    <div className={`w-36 shrink-0 text-sm ${isTop ? 'font-semibold' : ''}`}>{s.name}{isTop && <span className="ml-1 text-amber-600">◆</span>}</div>
                    <div className="flex h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
                      {(['working', 'down', 'blocked', 'starved'] as const).map((k) => <div key={k} className={STATE_COLOR[k]} style={{ width: `${100 * sh[k]}%` }} title={`${STATE_RU[k]} ${Math.round(100 * sh[k])}%`} />)}
                    </div>
                    <div className="w-24 shrink-0 text-right text-xs tabular-nums text-slate-500">стоит {Math.round(run.kpi.downtime_min[s.id] / 2)} мин/см</div>
                  </div>
                )
              })}
            </div>
            <p className="mt-4 text-xs text-slate-500">◆ узкое место — найдено по активным периодам: участок, который дольше всех работает без перерыва и задерживает остальных.</p>
          </Card>

          <div>
            <h2 className="mb-3 text-lg font-semibold">Что будет, если…</h2>
            {!whatif ? <div className="text-sm text-slate-500">Сравниваю действия на 20 прогонах…</div> : (
              <div className="grid gap-4 lg:grid-cols-3">
                {whatif.options.map((o, i) => (
                  <Card key={o.id} className={`p-5 ${i === 0 && o.significant && o.delta_per_shift > 0 ? 'ring-2 ring-emerald-400' : ''}`}>
                    {i === 0 && o.significant && o.delta_per_shift > 0 && <div className="mb-2 text-xs font-semibold text-emerald-600">Лучшее действие</div>}
                    <div className="font-semibold">{o.name}</div>
                    <div className="mt-2 flex items-baseline gap-1">
                      <span className={`text-4xl font-semibold tracking-tight ${o.significant && o.delta_per_shift > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                        {o.delta_per_shift >= 0 ? '+' : ''}{fmt(Math.round(o.delta_per_shift * 10) / 10)}
                      </span>
                      <span className="text-sm text-slate-500">машин за смену</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {o.significant ? `точно в пределах ${fmt(Math.round(o.ci95[0] * 10) / 10)}…${fmt(Math.round(o.ci95[1] * 10) / 10)}` : 'эффект не подтверждён'}
                    </div>
                    <p className="mt-3 text-sm text-slate-600">{o.detail}</p>
                    <button onClick={() => { setFutures(o.id); window.scrollTo({ top: 0, behavior: 'smooth' }) }} className="mt-3 text-xs font-semibold text-emerald-700 hover:text-emerald-900">◐ Показать два будущих →</button>
                  </Card>
                ))}
              </div>
            )}
            <p className="mt-3 text-xs text-slate-500">Сравнение на {whatif?.reps ?? 20} одинаковых прогонах симуляции — это оценка на модели, а не гарантия на заводе.</p>
          </div>

          <details className="group">
            <summary className="cursor-pointer list-none text-sm font-medium text-slate-500 hover:text-slate-800">
              <span className="group-open:hidden">+ На каких допущениях построена модель</span><span className="hidden group-open:inline">− Скрыть допущения</span>
            </summary>
            <Card className="mt-3 divide-y divide-slate-100">
              {meta.assumptions.map((a) => <div key={a.id} className="flex items-start gap-3 px-5 py-3 text-sm"><SourceBadge source={a.source as 'assumption'} /><span className="text-slate-600">{a.text}</span></div>)}
            </Card>
          </details>
        </>
      )}
    </div>
  )
}
