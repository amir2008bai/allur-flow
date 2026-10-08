import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import ErrorBoundary from './ErrorBoundary'
import Dashboard from './twin/Dashboard'
import Flow2D from './twin/Flow2D'
import Plan2D from './twin/Plan2D'
import CauseBanner from './twin/CauseBanner'
import Futures from './twin/Futures'
import Actions from './twin/Actions'
import ShiftBuilder, { parseCfg, toCfg } from './twin/ShiftBuilder'
import EtaPanel from './twin/EtaPanel'
import MonthJournal from './twin/MonthJournal'
import { ZONES } from './twin/layout'
import Timeline from './twin/Timeline'
import ZonePanel from './twin/ZonePanel'
import { useView } from './twin/store'
import { useNet } from './net'
import { NeedServer } from './NetBanners'

const Scene3D = lazy(() => import('./twin/Scene3D'))
import { load, type Mode, type SimMeta, type SimRun, type WhatIf } from './source'
import { Card, SourceBadge } from './ui'

import { BottleneckBadge, STATUS, StatusLegend } from './theme'
import { CalendarDays, Columns2, Orbit, ShieldCheck, Square } from 'lucide-react'
import DatePicker from './DatePicker'
import { seedFromDate } from './dates'
import { isPhone } from './twin/store'
import { useReducedMotion } from './twin/motionPreference'
const STATE_RU: Record<string, string> = { working: 'работает', starved: 'ждёт кузов', blocked: 'некуда отдать', down: 'стоит' }

function TourButton({ horizon }: { horizon: number }) {
  const touring = useView((v) => v.touring)
  const setTouring = useView((v) => v.setTouring)
  const playing = useView((v) => v.playing)
  const reduce = useReducedMotion()
  const index = useRef(0)
  const elapsed = useRef(0)
  useEffect(() => {
    if (!touring) { index.current = 0; elapsed.current = 0 }
  }, [touring])
  useEffect(() => {
    if (!touring || !playing || reduce) return
    let previous = performance.now(), raf = 0
    const tick = (now: number) => {
      elapsed.current += Math.min((now - previous) / 1000, 0.1)
      previous = now
      if (elapsed.current >= 4) {
        elapsed.current = 0
        index.current++
        if (index.current >= ZONES.length) { useView.getState().select(null); setTouring(false); return }
        useView.getState().select(ZONES[index.current].id)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [touring, playing, reduce, setTouring])
  return (
    <button disabled={reduce} title={reduce ? 'Обзор отключён: включено уменьшение движения' : undefined} onClick={() => {
      if (touring) useView.getState().select(null)
      else {
        const state = useView.getState()
        if (state.t >= horizon - 1) state.setT(0)
        state.select(ZONES[0].id); state.setPlaying(true)
      }
      setTouring(!touring)
    }}
      className="absolute left-3 top-16 rounded-xl bg-white/90 px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 backdrop-blur hover:text-slate-900 disabled:opacity-50">
      {touring ? <><Square size={14} className="mr-1.5 inline" />Стоп</> : <><Orbit size={15} className="mr-1.5 inline" />Обзор линии</>}
    </button>
  )
}

export default function TwinPage() {
  const [meta, setMeta] = useState<SimMeta | null>(null)
  const scenario = useView((v) => v.scenario)
  const date = useView((v) => v.date)
  const setDate = useView((v) => v.setDate)
  const seed = seedFromDate(date)
  const [run, setRun] = useState<SimRun | null>(null)
  const [whatif, setWhatif] = useState<WhatIf | null>(null)
  const [mode, setMode] = useState<Mode>('live')
  const view = useView((v) => v.view)
  const [futures, setFutures] = useState<string | null>(null)
  const setView = useView((v) => v.setView)
  const offline = useNet((s) => s.server === false)

  useEffect(() => { load<SimMeta>('/api/sim/meta', '/bundles/meta.json').then((r) => setMeta(r.data)) }, [])
  useEffect(() => {
    setFutures(null); useView.getState().setPlaying(false)
    load<SimRun>(`/api/sim/run?scenario=${encodeURIComponent(scenario)}&seed=${seed}`, `/bundles/run_${scenario}.json`).then((r) => { setRun(r.data); setMode(r.mode) })
      }, [scenario, seed])
  // день по данным завода — действия сравниваются на его реальных событиях
  const faultsOnly = scenario.startsWith('day:') ? scenario : toCfg(parseCfg(scenario).faults, [], parseCfg(scenario).events)
  useEffect(() => {
    setWhatif(null)
    load<WhatIf>(`/api/sim/whatif?scenario=${encodeURIComponent(faultsOnly)}&reps=20`, `/bundles/whatif_${faultsOnly}.json`, 15000).then((r) => setWhatif(r.data))
  }, [faultsOnly])

  if (!meta) return <div className="text-sm text-slate-500">Загрузка…</div>
  const name = Object.fromEntries(meta.stations.map((s) => [s.id, s.name]))

  return (
    <div className="space-y-6">
      <div id="twin-viewer" className="flex scroll-mt-20 flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Как идёт смена на линии</h2>
        <span className="text-sm text-slate-500">{run?.scenario_name ?? ''}</span>
        <button onClick={() => { setFutures((whatif?.useful?.[0]) ?? 'fast_repair'); document.getElementById('twin-viewer')?.scrollIntoView({ behavior: 'smooth' }) }}
          className="ml-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"><Columns2 size={16} className="mr-1.5 inline -mt-0.5" />Два будущих рядом</button>
        <span className="ml-auto flex items-center gap-3 text-xs text-slate-500">
          <DatePicker value={date} onChange={setDate} />
          <button onClick={() => document.getElementById('journal')?.scrollIntoView({ behavior: 'smooth' })} className="flex items-center gap-1 rounded-xl bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"><CalendarDays size={14} />Журнал</button>
          <button onClick={() => { useView.getState().setTab('learning'); window.scrollTo({ top: 0 }) }} className="flex items-center gap-1 rounded-xl bg-white px-3 py-2 text-xs font-medium text-emerald-700 shadow-sm ring-1 ring-emerald-200 hover:bg-emerald-50"><ShieldCheck size={14} />Почему верить</button>
          <SourceBadge source="sim" />{mode === 'replay' && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">офлайн-режим</span>}
        </span>
      </div>

      {!run ? <div className="text-sm text-slate-500">Считаю симуляцию…</div> : (
        <>
          {futures && <Futures scenario={scenario} action={futures} seed={seed} onClose={() => setFutures(null)} />}
          {!futures && <Card className="overflow-hidden">
            <div className="relative h-[52vh] min-h-[380px] bg-[#f4f5f7] sm:h-[60vh] sm:min-h-[420px]">
              {view === '3d'
              ? <ErrorBoundary key={scenario} fallback={<div className="grid h-full place-items-center text-sm text-slate-500">3D недоступно на этом устройстве — откройте 2D-схему</div>}><Suspense fallback={<div className="grid h-full place-items-center text-sm text-slate-500">Загружаю 3D…</div>}><Scene3D run={run} quality={isPhone() ? 'low' : 'high'} /></Suspense></ErrorBoundary>
                : view === 'plan' ? <Plan2D run={run} /> : <Flow2D run={run} />}
              <div className="absolute left-3 top-3 flex rounded-xl bg-white/90 p-1 shadow-sm ring-1 ring-slate-200 backdrop-blur">
                {(['3d', 'plan', 'flow'] as const).map((v) => (
                  <button key={v} onClick={() => setView(v)} className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${view === v ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'}`}>
                    {v === '3d' ? '3D' : v === 'plan' ? 'План' : 'Схема'}
                  </button>
                ))}
              </div>
              {view === '3d' && <TourButton horizon={run.horizon} />}
              <div className="absolute bottom-3 left-3 rounded-xl bg-white/90 px-3 py-2 shadow-sm ring-1 ring-slate-200 backdrop-blur"><StatusLegend /></div>
              <CauseBanner run={run} />
              <ZonePanel run={run} />
            </div>
            <div className="border-t border-slate-100 px-5 py-4"><Timeline run={run} /></div>
            <EtaPanel seed={seed} />
          </Card>}
        </>
      )}

      <div id="shift-builder" className="scroll-mt-20">{offline ? <NeedServer what="«Смена: план и прогноз» пересчитывается на сервере под выбранные сбои и действия." /> : <ShiftBuilder />}</div>

      <div id="journal" className="scroll-mt-20">{offline ? <NeedServer what="Журнал смен хранится на сервере." /> : <MonthJournal />}</div>

      {run && (
        <>

          <Actions whatif={whatif} onFutures={(id) => { setFutures(id); document.getElementById('twin-viewer')?.scrollIntoView({ behavior: 'smooth' }) }} />

          <Dashboard run={run} />

          <Card className="p-5">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="font-semibold">Что делает каждый участок</h2>
              <StatusLegend bottleneck={false} />
            </div>
            <div className="space-y-3">
              {meta.stations.map((s) => {
                const sh = run.kpi.state_shares[s.id]
                const isTop = run.bottleneck.top === s.id
                return (
                  <div key={s.id} className="flex items-center gap-3">
                    <div className={`w-36 shrink-0 text-sm ${isTop ? 'font-semibold' : ''}`}>{s.name}{isTop && <span className="ml-1.5 inline-block align-middle"><BottleneckBadge size={10} /></span>}</div>
                    <div className="flex h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
                      {(['working', 'down', 'blocked', 'starved'] as const).map((k) => <div key={k} style={{ width: `${100 * sh[k]}%`, background: STATUS[k].hex }} title={`${STATUS[k].label} ${Math.round(100 * sh[k])}%`} />)}
                    </div>
                    <div className="w-24 shrink-0 text-right text-xs tabular-nums text-slate-500">стоит {Math.round(run.kpi.downtime_min[s.id] / 2)} мин/см</div>
                  </div>
                )
              })}
            </div>
            <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-500"><BottleneckBadge size={10} /> узкое место — участок, который дольше всех работает без перерыва и задерживает остальных.</p>
          </Card>

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
