import { useEffect, useState } from 'react'
import { useReducedMotion } from '../twin/motionPreference'
import { COMP_BY, CYCLE } from './model'

const R = 170, C = 230
const ICON_HEX = ['#0ea5e9', '#7c3aed', '#6366f1', '#16a34a', '#f59e0b', '#14b8a6']

/** Цикл решения: видим → понимаем → прогнозируем → предлагаем → человек решает → учимся → снова. */
export default function ArchCycle({ onSelect }: { onSelect: (id: string | null) => void }) {
  const reduce = useReducedMotion()
  const [active, setActive] = useState(0)
  const [hold, setHold] = useState(false)
  useEffect(() => {
    if (reduce || hold) return
    const t = setInterval(() => setActive((a) => (a + 1) % CYCLE.length), 2600)
    return () => clearInterval(t)
  }, [reduce, hold])

  const pt = (i: number, r = R) => { const a = -Math.PI / 2 + (i / CYCLE.length) * 2 * Math.PI; return [C + r * Math.cos(a), C + r * Math.sin(a)] }
  const arc = (i: number) => {
    const a0 = -Math.PI / 2 + ((i + 0.17) / CYCLE.length) * 2 * Math.PI, a1 = -Math.PI / 2 + ((i + 0.83) / CYCLE.length) * 2 * Math.PI
    return `M ${C + R * Math.cos(a0)} ${C + R * Math.sin(a0)} A ${R} ${R} 0 0 1 ${C + R * Math.cos(a1)} ${C + R * Math.sin(a1)}`
  }
  const s = CYCLE[active]

  return (
    <div className="grid items-center gap-4 rounded-2xl bg-slate-50/60 p-4 ring-1 ring-slate-100 md:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
      <svg viewBox="0 0 460 460" className="mx-auto w-full max-w-[460px]" role="img" aria-label="Цикл решения">
        <defs>
          <marker id="cyc-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" /></marker>
        </defs>
        <circle cx={C} cy={C} r={R} fill="none" stroke="#e2e8f0" strokeWidth="22" />
        {CYCLE.map((_, i) => (
          <path key={i} d={arc(i)} fill="none" stroke={i === active ? ICON_HEX[i] : '#cbd5e1'} strokeWidth={i === active ? 4 : 2} markerEnd="url(#cyc-arrow)"
            style={{ transition: 'stroke .4s' }} />
        ))}
        {CYCLE.map((c, i) => {
          const [x, y] = pt(i)
          const on = i === active
          return (
            <g key={c.id} transform={`translate(${x},${y})`} className="cursor-pointer" onClick={() => { setActive(i); setHold(true) }}>
              <circle r={on ? 34 : 29} fill={on ? ICON_HEX[i] : '#ffffff'} stroke={ICON_HEX[i]} strokeWidth="2" style={{ transition: 'all .35s' }} />
              <text textAnchor="middle" dy="5" fontSize="15" fontWeight="700" fill={on ? '#ffffff' : ICON_HEX[i]}>{i + 1}</text>
              <text textAnchor="middle" y={on ? 52 : 47} fontSize="13" fontWeight="600" fill="#0f172a">{c.title}</text>
            </g>
          )
        })}
        <text x={C} y={C - 8} textAnchor="middle" fontSize="13" fill="#64748b">каждую смену</text>
        <text x={C} y={C + 14} textAnchor="middle" fontSize="18" fontWeight="700" fill="#0f172a">цикл решения</text>
      </svg>
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: ICON_HEX[active] }}>Шаг {active + 1} из {CYCLE.length}</div>
        <div className="mt-1 text-xl font-semibold">{s.title}</div>
        <p className="mt-1 text-sm text-slate-600">{s.text}</p>
        <div className="mt-3 text-xs text-slate-500">Что работает на этом шаге:</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {s.comps.map((id) => (
            <button key={id} onClick={() => onSelect(id)} className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">{COMP_BY[id]?.name}</button>
          ))}
        </div>
        <div className="mt-3 flex gap-2 text-xs">
          <button onClick={() => { setActive((a) => (a + CYCLE.length - 1) % CYCLE.length); setHold(true) }} className="rounded-lg px-2 py-1 text-slate-500 ring-1 ring-slate-200 hover:bg-white">← назад</button>
          <button onClick={() => { setActive((a) => (a + 1) % CYCLE.length); setHold(true) }} className="rounded-lg px-2 py-1 text-slate-500 ring-1 ring-slate-200 hover:bg-white">дальше →</button>
          {hold && !reduce && <button onClick={() => setHold(false)} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-white">▶ по кругу</button>}
        </div>
      </div>
    </div>
  )
}
