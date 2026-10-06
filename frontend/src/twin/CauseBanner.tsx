import type { SimRun } from '../source'
import { ROLE_HEX, shortText, type CauseStep } from './cause'
import { clock } from './Timeline'
import { useCause } from './useCause'

/** Строка «причина → следствие» поверх любого вида. Плавно появляется, не мелькает.
 *  compact — для узких окон: причина → первое следствие → итог, остальное свёрнуто в «+N». */
export default function CauseBanner({ run, compact = false }: { run: SimRun; compact?: boolean }) {
  const inc = useCause(run)
  let steps: (CauseStep | { more: number })[] = inc?.steps ?? []
  if (inc && compact && inc.steps.length > 3) {
    const [cause, first, ...rest] = inc.steps
    const result = rest.find((s) => s.role === 'result')
    const hidden = rest.length - (result ? 1 : 0)
    steps = [cause, first, ...(hidden > 0 ? [{ more: hidden }] : []), ...(result ? [result] : [])]
  }
  return (
    <div className={`pointer-events-none absolute inset-x-0 ${compact ? "bottom-3" : "bottom-14"} flex justify-center px-3`}>
      {inc && (
        <div key={inc.start + inc.key} className="flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-2xl bg-white/95 px-3 py-1.5 text-sm shadow-lg ring-1 ring-slate-200 backdrop-blur [animation:causein_.5s_ease]">
          {steps.map((s, i) => (
            <span key={'more' in s ? 'more' : s.zone} className="flex items-center gap-1.5 whitespace-nowrap">
              {i > 0 && <span className="text-slate-300">→</span>}
              {'more' in s
                ? <span className="rounded-full bg-slate-100 px-2 text-xs text-slate-500">+{s.more}</span>
                : <>
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white" style={{ background: ROLE_HEX[s.role] }}>{s.order}</span>
                    <b className="font-semibold">{s.title}</b><span className="text-slate-500">{shortText(s)}</span>
                  </>}
            </span>
          ))}
          {!compact && <span className="whitespace-nowrap text-xs text-slate-400">с {clock(inc.start)} · {Math.round(inc.end - inc.start)} мин</span>}
        </div>
      )}
      <style>{'@keyframes causein{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}'}</style>
    </div>
  )
}
