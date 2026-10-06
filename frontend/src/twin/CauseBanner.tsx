import type { SimRun } from '../source'
import { ROLE_HEX, shortText } from './cause'
import { clock } from './Timeline'
import { useCause } from './useCause'

/** Одна строка «причина → следствие» поверх любого вида. Плавно появляется, не мелькает. */
export default function CauseBanner({ run }: { run: SimRun }) {
  const inc = useCause(run)
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-14 flex justify-center px-3">
      {inc && (
        <div key={inc.start + inc.key} className="flex max-w-full items-center gap-2 overflow-hidden whitespace-nowrap rounded-full bg-white/95 py-1.5 pl-2 pr-4 text-sm shadow-lg ring-1 ring-slate-200 backdrop-blur [animation:causein_.5s_ease]">
          {inc.steps.map((s, i) => (
            <span key={s.zone} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-slate-300">→</span>}
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white" style={{ background: ROLE_HEX[s.role] }}>{s.order}</span>
              <b className="font-semibold">{s.title}</b><span className="text-slate-500">{shortText(s)}</span>
            </span>
          ))}
          <span className="ml-1 text-xs text-slate-400">с {clock(inc.start)} · {Math.round(inc.end - inc.start)} мин</span>
        </div>
      )}
      <style>{'@keyframes causein{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}'}</style>
    </div>
  )
}
