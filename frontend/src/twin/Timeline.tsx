import { useEffect, useRef } from 'react'
import type { SimRun } from '../source'
import { ZONE_BY_STATION } from './layout'
import { useView } from './store'
import { shortDate } from '../dates'

// цвета участков на «волне узкого места» — не пересекаются с цветами статусов
export const BN_COLOR: Record<string, string> = { welding: '#0ea5e9', paint: '#7c3aed', assembly: '#334155', qc: '#a8a29e' }

export function clock(t: number) {
  const m = Math.floor(t) + 8 * 60
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export default function Timeline({ run }: { run: SimRun }) {
  const { t, playing, speed, setT, setPlaying, setSpeed } = useView()
  const last = useRef<number | null>(null)
  const H = run.horizon

  useEffect(() => {
    if (!playing) { last.current = null; return }
    let raf = 0
    const tick = (now: number) => {
      if (last.current !== null) {
        const nt = useView.getState().t + ((now - last.current) / 1000) * useView.getState().speed
        if (nt >= H - 1) { setT(H - 1); setPlaying(false); return }
        setT(nt)
      }
      last.current = now
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, H, setT, setPlaying])

  const shift = t < 480 ? 1 : 2
  const good = run.frames[Math.min(Math.floor(t), run.frames.length - 1)]?.good ?? 0

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 sm:flex-nowrap">
      <button onClick={() => { if (t >= H - 1) setT(0); setPlaying(!playing) }}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-900 text-white shadow-sm hover:bg-slate-700" aria-label={playing ? 'Пауза' : 'Пуск'}>
        {playing ? <svg width="14" height="14" viewBox="0 0 14 14"><rect x="2" y="1" width="3.5" height="12" rx="1" fill="currentColor" /><rect x="8.5" y="1" width="3.5" height="12" rx="1" fill="currentColor" /></svg>
          : <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 1.5v11l9-5.5z" fill="currentColor" /></svg>}
      </button>
      <div className="mr-auto w-24 shrink-0 sm:mr-0">
        <div className="text-lg font-semibold tabular-nums leading-none">{clock(t)}</div>
        <div className="mt-1 text-[11px] text-slate-500">{shortDate(useView.getState().date)} · смена {shift} · {good} годных</div>
      </div>
      <div className="relative order-last basis-full sm:order-none sm:basis-auto sm:flex-1">
        {/* волна узкого места: какой участок ограничивал поток в каждые 10 минут */}
        <div className="mb-1.5 flex h-2 overflow-hidden rounded-full">
          {run.bottleneck.timeline.map((s, i) => (
            <div key={i} className="h-full flex-1" style={{ background: s.station ? BN_COLOR[s.station] : '#e2e8f0' }}
              title={`${clock(s.t)} — узкое место: ${s.station ? ZONE_BY_STATION[s.station]?.name : '—'}`} />
          ))}
        </div>
        <div className="relative">
          {run.stops.filter((s) => !s.planned || true).map((s, i) => (
            <div key={i} className={`absolute -top-0.5 h-3 w-1 rounded-full ${s.planned ? 'bg-sky-400' : 'bg-red-500'}`} style={{ left: `${(100 * s.t) / H}%` }}
              title={`${clock(s.t)} · ${ZONE_BY_STATION[s.station]?.name}: ${s.reason}, ${Math.round(s.minutes)} мин`} />
          ))}
          <div className="absolute top-0 h-2 w-px bg-slate-300" style={{ left: '50%' }} />
          <input type="range" min={0} max={H - 1} step={1} value={t} onChange={(e) => { setPlaying(false); setT(Number(e.target.value)) }}
            className="relative h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-slate-900" aria-label="Время смены" />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-slate-400"><span>08:00</span><span>16:00 · смена 2</span><span>24:00</span></div>
        <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-slate-500">
          <span>узкое место:</span>
          {Object.entries(BN_COLOR).filter(([k]) => k !== 'qc').map(([k, c]) => <span key={k} className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-full" style={{ background: c }} />{ZONE_BY_STATION[k]?.name.toLowerCase()}</span>)}
        </div>
      </div>
      <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="shrink-0 rounded-lg bg-white px-2 py-1.5 text-xs ring-1 ring-slate-200" aria-label="Скорость">
        {[5, 20, 60, 120].map((s) => <option key={s} value={s}>×{s * 60}</option>)}
      </select>
    </div>
  )
}
