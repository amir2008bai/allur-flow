import type { SimRun } from '../source'
import { BUFFERS, STATE_HEX, STATE_RU, ZONES, ZONE_BY_ID, type StationState } from './layout'
import { useView } from './store'
import { clock } from './Timeline'
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react'

export default function ZonePanel({ run }: { run: SimRun }) {
  const selected = useView((s) => s.selected)
  const select = useView((s) => s.select)
  const t = useView((s) => s.t)
  if (!selected) return null
  const z = ZONE_BY_ID[selected]
  const index = ZONES.findIndex((zone) => zone.id === selected)
  const previous = ZONES[(index - 1 + ZONES.length) % ZONES.length]
  const next = ZONES[(index + 1) % ZONES.length]
  const goTo = (id: typeof selected) => { useView.getState().setTouring(false); select(id) }
  const frame = run.frames[Math.min(Math.floor(t), run.frames.length - 1)]
  const st = z.station ? (frame.states[z.station] as StationState) : null
  const before = BUFFERS.find((b) => b.to === z.id)
  const after = BUFFERS.find((b) => b.from === z.id)
  const stops = z.station ? run.stops.filter((s) => s.station === z.station && s.t <= t) : []
  const bn = z.station ? run.bottleneck.sole[z.station] + run.bottleneck.shifting[z.station] : 0

  return (
    <div className="absolute left-3 right-3 top-3 bottom-3 overflow-y-auto sm:left-auto sm:w-72 rounded-2xl bg-white/95 p-5 shadow-lg ring-1 ring-slate-200 backdrop-blur">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-lg font-semibold">{z.name}</div>
          {z.equipment.length > 0 && <div className="text-xs text-slate-500">{z.equipment.join(' · ')}</div>}
        </div>
        <button onClick={() => select(null)} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Закрыть">✕</button>
      </div>

      <div className="mt-3 flex gap-2" aria-label="Переключение участков">
        <button onClick={() => goTo(previous.id)} aria-label={`Предыдущий участок: ${previous.name}`} title={previous.name}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-1 rounded-xl bg-slate-50 px-2 text-xs font-medium text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-sky-500">
          <ChevronLeft size={17} className="shrink-0" /><span className="truncate">{previous.short}</span>
        </button>
        <button onClick={() => goTo(next.id)} aria-label={`Следующий участок: ${next.name}`} title={next.name}
          className="flex min-h-11 min-w-0 flex-1 items-center justify-end gap-1 rounded-xl bg-slate-50 px-2 text-xs font-medium text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-sky-500">
          <span className="truncate">{next.short}</span><ChevronRight size={17} className="shrink-0" />
        </button>
      </div>

      {st && (
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATE_HEX[st] }} />
          <span className="text-sm font-medium">{clock(t)} — {STATE_RU[st]}</span>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        {before && <Stat label="Буфер перед" value={`${frame.buffers[before.id]}/${run.buffer_cap[before.id]}`} warn={frame.buffers[before.id] === 0} />}
        {after && <Stat label="Буфер после" value={`${frame.buffers[after.id]}/${run.buffer_cap[after.id]}`} warn={frame.buffers[after.id] >= run.buffer_cap[after.id]} />}
        {z.station && <Stat label="Брак за 2 смены" value={`${(run.kpi.defect_pct[z.station] ?? 0).toFixed(1).replace('.', ',')}%`} warn={(run.kpi.defect_pct[z.station] ?? 0) > 2} />}
        {z.station && <Stat label="Узкое место" value={`${Math.round(100 * bn)}% времени`} warn={run.bottleneck.top === z.station} />}
        {z.id === 'warehouse_out' && <Stat label="Годных к этому моменту" value={String(frame.good)} />}
      </div>

      {z.station && (
        <div className="mt-4">
          <div className="text-xs font-medium text-slate-500">Остановки до {clock(t)}</div>
          {stops.length === 0 ? <div className="mt-1 text-sm text-slate-400">не было</div> : (
            <ul className="mt-1 space-y-1">
              {stops.map((s, i) => (
                <li key={i} className="flex justify-between gap-2 text-sm">
                  <span className="text-slate-600">{clock(s.t)} · {s.reason}</span>
                  <span className="shrink-0 tabular-nums font-medium">{Math.round(s.minutes)} мин</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <button onClick={() => useView.getState().ask(`Что происходит на участке «${z.name}» и что сделать, чтобы он не задерживал линию?`)}
        className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl bg-violet-50 py-2 text-sm font-medium text-violet-700 hover:bg-violet-100"><Sparkles size={15} />Спросить ИИ про участок</button>
      <div className="mt-3 text-[11px] text-slate-400">Симуляция · компоновка цеха условная</div>
    </div>
  )
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`text-sm font-semibold ${warn ? 'text-amber-600' : ''}`}>{value}</div>
    </div>
  )
}
