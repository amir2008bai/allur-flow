import { Timer, Wrench } from 'lucide-react'
import { useEffect, useState } from 'react'
import { tenge, useMoney } from '../money'
import { BottleneckBadge } from '../theme'
import { Card, SourceBadge } from '../ui'

interface Row { station: string; name: string; loss_per_hour: number; loss_ci: [number, number]; loss_per_min: number; gain_per_hour: number; gain_ci: [number, number]; limits_output: boolean }
interface Value { stations: Row[]; constraint: string | null; reps: number; gain_reps: number; method: string }

const n1 = (x: number) => x.toFixed(1).replace('.', ',')
const sgn = (x: number) => (x > 0.05 ? '+' : x < -0.05 ? '−' : '')

/** Цена минуты простоя каждого участка и проверка узкого места «+1 час»: какой ремонт делать первым. */
export default function StationValue() {
  const [d, setD] = useState<Value | null>(null)
  const money = useMoney()
  useEffect(() => { fetch('/api/sim/station_value').then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => {}) }, [])
  if (!d) return <Card className="p-5 text-sm text-slate-500">Считаю цену простоя участков…</Card>

  const rows = [...d.stations].sort((a, b) => b.loss_per_min - a.loss_per_min)
  const top = rows[0]
  const cheap = rows[rows.length - 1]
  const lim = d.stations.find((r) => r.station === d.constraint)
  const perMin = (r: Row) => r.loss_per_min * money.margin

  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-700"><Timer size={18} /></span>
          <div>
            <h2 className="text-lg font-semibold leading-tight">Цена минуты простоя</h2>
            <p className="text-sm text-slate-500">Какой ремонт делать первым, если сломалось сразу несколько участков.</p>
          </div>
        </div>
        <SourceBadge source="sim" />
      </div>

      <div className="flex items-start gap-2 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700 ring-1 ring-slate-100">
        <Wrench size={16} className="mt-0.5 shrink-0 text-slate-500" />
        <div>
          Минута простоя участка «{top.name}» стоит <b className="tabular-nums">{tenge(perMin(top))}</b>, а участка «{cheap.name}» — <b className="tabular-nums">{tenge(perMin(cheap))}</b>
          {top.loss_per_min > 1.2 * cheap.loss_per_min ? <> — в {n1(top.loss_per_min / cheap.loss_per_min)} раза дороже. При нескольких поломках сразу ремонтируйте «{top.name}» первым.</> : <> — почти одинаково: накопители почти не прикрывают участки.</>}
          {lim && <> Ограничитель линии — <b>{lim.name}</b>: только ей лишний час работы даёт машины (+{n1(lim.gain_per_hour)} за смену).</>}
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="text-left text-[11px] text-slate-400">
              <th className="py-1.5 font-normal">участок</th>
              <th className="py-1.5 text-right font-normal">час простоя</th>
              <th className="py-1.5 text-right font-normal">минута стоит</th>
              <th className="py-1.5 text-right font-normal">+1 час работы в смену</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.station}>
                <td className="py-2 font-medium">{r.name}{r.limits_output && <span className="ml-1.5 inline-block align-middle"><BottleneckBadge size={10} /></span>}</td>
                <td className="py-2 text-right tabular-nums">−{n1(r.loss_per_hour)} маш. <span className="text-[11px] text-slate-400">({n1(r.loss_ci[0])}–{n1(r.loss_ci[1])})</span></td>
                <td className="py-2 text-right font-semibold tabular-nums">{tenge(perMin(r))}</td>
                <td className={`py-2 text-right tabular-nums ${r.gain_ci[0] > 0 ? 'font-semibold text-emerald-700' : 'text-slate-400'}`}>
                  {r.gain_ci[0] > 0 ? `${sgn(r.gain_per_hour)}${n1(Math.abs(r.gain_per_hour))} маш.` : 'не даёт машин'}
                  <span className="ml-1 text-[11px] font-normal text-slate-400">({n1(r.gain_ci[0])}–{n1(r.gain_ci[1])})</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] text-slate-400">
        Как считали: {d.method} Простой — {d.reps} пар смен, +1 час — {d.gain_reps}. Деньги — потерянные машины × маржа {tenge(money.margin)} с машины (меняется в «Из чего считаем заработок»).
        «Не даёт машин» — участок не ограничивает выпуск: ускорять его бесполезно, пока не ускорен ограничитель.
      </p>
    </Card>
  )
}
