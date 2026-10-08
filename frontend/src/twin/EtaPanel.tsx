import { CircleStop, Clock3, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { SourceBadge } from '../ui'
import { parseCfg, toCfg } from './ShiftBuilder'
import { useView } from './store'
import { clock } from './Timeline'

interface Eta {
  shift: number; t: number; shift_start: number; shift_end: number; plan: number
  done: number; remaining_mean: number; remaining_range: [number, number]
  total_mean: number; total_range: [number, number]; p_plan: number
  start: { total_mean: number; total_range: [number, number]; p_plan: number }
  ended: boolean; actual: number | null; reps: number
  prev: { actual: number; total_mean: number; total_range: [number, number]; p_plan: number } | null
  events: { station: string; name: string; at: number; minutes: number }[]
}

const int = (x: number) => Math.round(x).toLocaleString('ru-RU')
const pct = (x: number) => `${Math.round(100 * x)}%`
const STATIONS = [{ id: 'welding', name: 'Сварка' }, { id: 'paint', name: 'Окраска' }, { id: 'assembly', name: 'Сборка' }]
const DURATIONS = [15, 30, 60]
const tone = (p: number) => (p >= 0.7 ? 'text-emerald-600' : p >= 0.35 ? 'text-amber-600' : 'text-red-600')

/** «К концу смены»: сделано (факт прогона) + остаток (30 прогонов той же смены). Пересчитывается по ходу таймлайна.
 *  «Остановить сейчас» — что-если: участок встаёт в текущую минуту, прогноз сразу меняется. */
export default function EtaPanel({ seed }: { seed: number }) {
  const scenario = useView((v) => v.scenario)
  const setScenario = useView((v) => v.setScenario)
  const t = useView((v) => v.t)
  const bucket = Math.min(960, Math.floor(t / 10) * 10)        // пересчёт раз в 10 минут смены — без мелькания
  const [eta, setEta] = useState<Eta | null>(null)
  const cache = useRef(new Map<string, Eta>())
  const [station, setStation] = useState('assembly')
  const [minutes, setMinutes] = useState(30)

  useEffect(() => {
    const key = `${scenario}|${seed}|${bucket}`
    const hit = cache.current.get(key)
    if (hit) { setEta(hit); return }
    let alive = true
    fetch(`/api/sim/eta?scenario=${encodeURIComponent(scenario)}&seed=${seed}&t=${bucket}`).then((r) => (r.ok ? r.json() : null))
      .then((d: Eta | null) => { if (d && alive) { cache.current.set(key, d); setEta(d) } }).catch(() => {})
    return () => { alive = false }
  }, [scenario, seed, bucket])

  const cfg = parseCfg(scenario)
  const stopNow = () => {
    const at = Math.min(959, Math.round(t))
    setScenario(toCfg(cfg.faults, cfg.actions, [...cfg.events, `${station}@${at}+${minutes}`]))
  }
  const removeEvent = (i: number) => setScenario(toCfg(cfg.faults, cfg.actions, cfg.events.filter((_, j) => j !== i)))

  if (!eta) return <div className="h-[92px] border-t border-slate-100" />
  const shiftEnd = clock(eta.shift_end)
  const delta = eta.total_mean - eta.start.total_mean
  const changed = Math.abs(delta) >= 1.5 && eta.t > eta.shift_start

  return (
    <div className="border-t border-slate-100 px-5 py-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {/* прогноз к концу смены */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Clock3 size={13} />
            {eta.ended ? <>Смена {eta.shift} закончилась</> : <>Сейчас {clock(eta.t)} · к концу смены {eta.shift} ({shiftEnd})</>}
            <SourceBadge source="forecast" />
          </div>
          {eta.ended ? (
            <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-3xl font-semibold tabular-nums">{int(eta.actual ?? 0)}</span>
              <span className="text-sm text-slate-600">факт · утром прогноз был {int(eta.start.total_mean)} ({int(eta.start.total_range[0])}–{int(eta.start.total_range[1])})
                {eta.actual != null && <b className={eta.actual >= eta.start.total_range[0] && eta.actual <= eta.start.total_range[1] ? ' text-emerald-600' : ' text-amber-600'}>
                  {eta.actual >= eta.start.total_range[0] && eta.actual <= eta.start.total_range[1] ? ' · попал в коридор' : ' · вне коридора'}</b>}
              </span>
            </div>
          ) : (
            <>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="text-3xl font-semibold tabular-nums">{int(eta.total_mean)}</span>
                <span className="text-sm tabular-nums text-slate-500">обычно {int(eta.total_range[0])}–{int(eta.total_range[1])}</span>
                <span className={`text-sm font-semibold ${tone(eta.p_plan)}`}>план {eta.plan}: {eta.p_plan >= 0.995 ? 'выполним' : eta.p_plan <= 0.005 ? 'не выполним' : `вероятность ${pct(eta.p_plan)}`}</span>
              </div>
              <div className="mt-1 text-xs tabular-nums text-slate-500">
                сделано {int(eta.done)} · ещё ≈ {int(eta.remaining_mean)}
                {eta.t > eta.shift_start && <> · утром прогноз был {int(eta.start.total_mean)} ({pct(eta.start.p_plan)})
                  {changed && <b className={delta < 0 ? ' text-red-600' : ' text-emerald-600'}> · {delta > 0 ? '+' : '−'}{int(Math.abs(delta))} к утреннему</b>}</>}
              </div>
            </>
          )}
          {eta.prev && <div className="mt-1 text-xs text-slate-400">Смена 1: факт {int(eta.prev.actual)} · утром прогноз был {int(eta.prev.total_mean)} ({int(eta.prev.total_range[0])}–{int(eta.prev.total_range[1])})</div>}
        </div>

        {/* что-если: остановить участок прямо сейчас */}
        <div className="min-w-0 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">
          <div className="text-xs font-medium text-slate-600">Что если прямо сейчас встанет…</div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {STATIONS.map((s) => (
              <button key={s.id} onClick={() => setStation(s.id)} className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 transition ${station === s.id ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-100'}`}>{s.name}</button>
            ))}
            <span className="mx-1 text-xs text-slate-400">на</span>
            {DURATIONS.map((m) => (
              <button key={m} onClick={() => setMinutes(m)} className={`rounded-lg px-2.5 py-1.5 text-xs font-medium tabular-nums ring-1 transition ${minutes === m ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-100'}`}>{m} мин</button>
            ))}
          </div>
          <button onClick={stopNow} disabled={eta.ended || cfg.events.length >= 6}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl bg-red-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-red-500 active:scale-[.98] disabled:opacity-40">
            <CircleStop size={15} />Остановить в {clock(Math.round(t))}
          </button>
          {eta.events.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {eta.events.map((e, i) => (
                <span key={`${e.station}${e.at}`} className="flex items-center gap-1 rounded-full bg-white py-0.5 pl-2.5 pr-1 text-[11px] text-slate-700 ring-1 ring-red-200">
                  {e.name} {clock(e.at)} · {e.minutes} мин
                  <button onClick={() => removeEvent(i)} className="rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Убрать остановку"><X size={12} /></button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <p className="mt-2 text-[11px] text-slate-400">Сделано — факт этой смены до текущей минуты; остаток — {eta.reps} прогонов той же смены. Двигайте время на шкале — прогноз пересчитается.</p>
    </div>
  )
}
