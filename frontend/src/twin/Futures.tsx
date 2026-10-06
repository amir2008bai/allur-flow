import { Suspense, lazy, useEffect, useState } from 'react'
import ErrorBoundary from '../ErrorBoundary'
import type { SimRun } from '../source'
import { Card, SourceBadge } from '../ui'
import CauseBanner from './CauseBanner'
import Plan2D from './Plan2D'
import Timeline from './Timeline'
import { useView } from './store'

const Scene3D = lazy(() => import('./Scene3D'))

interface FuturesPayload { action: { id: string; name: string; detail: string }; do_nothing: SimRun; intervene: SimRun }

/** «Два будущих рядом»: одна и та же смена — без вмешательства и с ним. Одинаковые случайности, общий таймлайн. */
export default function Futures({ scenario, action, onClose }: { scenario: string; action: string; onClose: () => void }) {
  const [f, setF] = useState<FuturesPayload | null>(null)
  const [view, setView] = useState<'3d' | 'plan'>('plan')
  const t = useView((v) => v.t)

  useEffect(() => {
    setF(null)
    fetch(`/api/sim/futures?scenario=${scenario}&action=${action}&seed=7`).then((r) => r.json()).then((d: FuturesPayload) => {
      setF(d)
      const v = useView.getState()
      v.setPlaying(false); v.setT(0); v.select(null); v.setSpeed(60)
      setTimeout(() => useView.getState().setPlaying(true), 500)
    })
  }, [scenario, action])

  if (!f) return <Card className="grid h-64 place-items-center text-sm text-slate-500">Считаю два будущих…</Card>
  const i = Math.min(Math.floor(t), f.do_nothing.frames.length - 1)
  const a = f.do_nothing.frames[i]?.good ?? 0
  const b = f.intervene.frames[i]?.good ?? 0
  const d = b - a

  const pane = (run: SimRun, title: string, good: number, tone: 'base' | 'good') => (
    <div className="relative overflow-hidden rounded-2xl bg-[#f4f5f7] ring-1 ring-slate-200">
      <div className="h-[42vh] min-h-[300px]">
        {view === '3d'
          ? <ErrorBoundary fallback={<Plan2D run={run} />}><Suspense fallback={null}><Scene3D run={run} quality="low" /></Suspense></ErrorBoundary>
          : <Plan2D run={run} />}
      </div>
      <div className={`absolute left-3 top-3 rounded-xl px-3 py-1.5 text-sm font-semibold shadow-sm ${tone === 'good' ? 'bg-emerald-600 text-white' : 'bg-white/95 text-slate-800 ring-1 ring-slate-200'}`}>{title}</div>
      <div className="absolute right-3 top-3 rounded-xl bg-white/95 px-3 py-1.5 text-right shadow-sm ring-1 ring-slate-200">
        <div className="text-[10px] text-slate-500">годных</div>
        <div className="text-xl font-semibold tabular-nums leading-none">{good}</div>
      </div>
      <div className="[&>div]:bottom-3"><CauseBanner run={run} /></div>
    </div>
  )

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Два будущих одной смены</div>
          <div className="text-xs text-slate-500">Слева — ничего не делаем. Справа — «{f.action.name}». Случайности одинаковые.</div>
        </div>
        <div className="flex rounded-xl bg-slate-100 p-1">
          {(['plan', '3d'] as const).map((v) => <button key={v} onClick={() => setView(v)} className={`rounded-lg px-3 py-1 text-xs font-medium ${view === v ? 'bg-white shadow-sm' : 'text-slate-500'}`}>{v === '3d' ? '3D' : 'План'}</button>)}
        </div>
        <SourceBadge source="sim" />
        <button onClick={onClose} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Закрыть">✕</button>
      </div>
      <div className="relative grid gap-3 p-3 lg:grid-cols-2">
        {pane(f.do_nothing, 'Ничего не делаем', a, 'base')}
        {pane(f.intervene, f.action.name, b, 'good')}
        {/* живой счётчик разницы между будущими */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 lg:block">
          <div className={`rounded-2xl px-5 py-3 text-center shadow-2xl ring-4 ring-white transition-colors ${d > 0 ? 'bg-emerald-600 text-white' : d < 0 ? 'bg-red-600 text-white' : 'bg-white text-slate-700'}`}>
            <div className="text-3xl font-bold tabular-nums leading-none">{d > 0 ? '+' : ''}{d}</div>
            <div className="mt-1 text-[11px] opacity-90">машин</div>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-center gap-2 pb-1 text-sm lg:hidden">
        <span className={`rounded-full px-3 py-1 font-semibold ${d > 0 ? 'bg-emerald-600 text-white' : 'bg-slate-100'}`}>{d > 0 ? '+' : ''}{d} машин</span>
      </div>
      <div className="border-t border-slate-100 px-5 py-4"><Timeline run={f.do_nothing} /></div>
    </Card>
  )
}
