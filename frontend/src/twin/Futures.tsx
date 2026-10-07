import { Suspense, lazy, useEffect, useState } from 'react'
import ErrorBoundary from '../ErrorBoundary'
import type { SimRun } from '../source'
import { Card, SourceBadge } from '../ui'
import CauseBanner from './CauseBanner'
import Plan2D from './Plan2D'
import Timeline, { clock } from './Timeline'
import { useView } from './store'
import { NeedServer } from '../NetBanners'
import { useNet } from '../net'

const Scene3D = lazy(() => import('./Scene3D'))
const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'машину' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'машины' : 'машин')

interface FuturesPayload { at?: number | null; action: { id: string; name: string; detail: string }; do_nothing: SimRun; intervene: SimRun }

/** «Два будущих рядом»: одна и та же смена — без вмешательства и с ним. Одинаковые случайности, общий таймлайн. */
export default function Futures({ scenario, action, seed = 7, onClose }: { scenario: string; action: string; seed?: number; onClose: () => void }) {
  const [f, setF] = useState<FuturesPayload | null>(null)
  const [failed, setFailed] = useState(false)
  const offline = useNet((s) => s.server === false)
  const [view, setView] = useState<'3d' | 'plan'>('plan')
  const t = useView((v) => v.t)
  // «сейчас» = где стоит таймлайн, когда открыли два будущих: обслуживание камеры — в эту минуту
  const [now] = useState(() => Math.round(useView.getState().t))
  const at = action === 'paint_service' && now >= 30 && now <= 900 ? now : null

  useEffect(() => {
    setF(null); setFailed(false)
    fetch(`/api/sim/futures?scenario=${encodeURIComponent(scenario)}&action=${action}&seed=${seed}${at != null ? `&at=${at}` : ''}`).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() }).then((d: FuturesPayload) => {
      setF(d)
      const v = useView.getState()
      v.setPlaying(false); v.setT(at != null ? Math.max(0, at - 20) : 0); v.select(null); v.setSpeed(60)
      setTimeout(() => useView.getState().setPlaying(true), 500)
    }).catch(() => setFailed(true))
  }, [scenario, action, seed, at])

  if (!f && (failed || offline)) return <div className="space-y-2"><NeedServer what="«Два будущих» считаются на сервере по выбранной смене." /><button onClick={onClose} className="rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-white">← Вернуться к линии</button></div>
  if (!f) return <Card className="grid h-64 place-items-center text-sm text-slate-500">Считаю два будущих…</Card>
  const i = Math.min(Math.floor(t), f.do_nothing.frames.length - 1)
  const a = f.do_nothing.frames[i]?.good ?? 0
  const b = f.intervene.frames[i]?.good ?? 0
  const d = b - a
  const dEnd = f.intervene.frames[f.intervene.frames.length - 1].good - f.do_nothing.frames[f.do_nothing.frames.length - 1].good
  const atEnd = t >= f.do_nothing.frames.length - 2
  const inService = f.intervene.frames[i]?.states.paint === 'down' || (t >= (f.at ?? 200) && t <= (f.at ?? 200) + 60 && f.action.id === 'paint_service')

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
      <CauseBanner run={run} compact />
    </div>
  )

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Два будущих одной смены</div>
          <div className="text-xs text-slate-500">Слева — ничего не делаем. Справа — «{f.action.name}»{f.at != null ? ` в ${clock(f.at)} (сейчас)` : ''}. Случайности одинаковые.</div>
        </div>
        <div className="flex rounded-xl bg-slate-100 p-1">
          {(['plan', '3d'] as const).map((v) => <button key={v} onClick={() => setView(v)} className={`rounded-lg px-3 py-1 text-xs font-medium ${view === v ? 'bg-white shadow-sm' : 'text-slate-500'}`}>{v === '3d' ? '3D' : 'План'}</button>)}
        </div>
        <SourceBadge source="sim" />
        <button onClick={onClose} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Закрыть">✕</button>
      </div>
      {/* одна строка по центру: «справа минус слева», без привязки к половинкам */}
      <div className="flex flex-col items-center gap-1 border-b border-slate-100 px-5 py-4 text-center">
        <div className="flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1">
          <span className="text-lg tabular-nums text-slate-400">{a}</span>
          <span className="text-slate-300">→</span>
          <span className="text-lg font-semibold tabular-nums">{b}</span>
          <span className="text-sm text-slate-600">
            {d === 0 ? <>поровну</> : <>«{f.action.name}» {d > 0 ? 'впереди' : 'отстаёт'} на</>}
          </span>
          {d !== 0 && <span className={`text-3xl font-semibold tabular-nums ${d > 0 ? 'text-emerald-600' : 'text-red-600'}`}>{Math.abs(d)} {plural(Math.abs(d))}</span>}
        </div>
        <div className="text-xs text-slate-500">
          {atEnd ? <>итог 2 смен · {clock(t)}</> : <>сейчас {clock(t)}{d < 0 && inService ? ' · идёт обслуживание: линия стоит, потом догоняет' : ''} · к концу смены: <b className={dEnd >= 0 ? 'text-emerald-700' : 'text-red-700'}>{dEnd > 0 ? '+' : ''}{dEnd} {plural(Math.abs(dEnd))}</b></>}
        </div>
      </div>
      <div className="relative grid gap-3 p-3 lg:grid-cols-2">
        {pane(f.do_nothing, 'Ничего не делаем', a, 'base')}
        {pane(f.intervene, f.action.name, b, 'good')}
      </div>
      <div className="border-t border-slate-100 px-5 py-4"><Timeline run={f.do_nothing} /></div>
    </Card>
  )
}
