import { useMemo } from 'react'
import type { SimRun } from '../source'
import { ROLE_HEX, causeChain } from './cause'
import { useView } from './store'

/** Строка «причина → следствие» поверх любого вида (3D, План, Схема). */
export default function CauseBanner({ run }: { run: SimRun }) {
  const t = useView((s) => s.t)
  const frame = run.frames[Math.min(Math.floor(t), run.frames.length - 1)]
  const steps = useMemo(() => causeChain(frame, run, t), [frame, run, t])
  if (!steps.length) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-14 flex justify-center px-3">
      <div className="flex max-w-full flex-wrap items-center justify-center gap-x-1.5 gap-y-1 rounded-2xl bg-white/95 px-3 py-2 text-xs shadow-lg ring-1 ring-slate-200 backdrop-blur">
        {steps.map((s, i) => (
          <span key={s.zone} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-slate-300">→</span>}
            <span className="grid h-4 w-4 place-items-center rounded-full text-[10px] font-bold text-white" style={{ background: ROLE_HEX[s.role] }}>{s.order}</span>
            <b>{s.title}</b><span className="text-slate-500">{s.text}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
