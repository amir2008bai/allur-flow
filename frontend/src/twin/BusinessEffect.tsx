import { TrendingUp } from 'lucide-react'
import { useEffect, useState } from 'react'
import { effect as money$, tenge, useMoney } from '../money'
import { Card, SourceBadge } from '../ui'

interface Range { before: number; after: number }
interface Lever { name: string; what: string; delta_per_shift: number; ci: [number, number]; confirmed: boolean; downtime_per_shift: Range; oee: Range; paint_defect: Range; cost: { month: number; once: number } | null }
interface Effect { base: { good_per_shift: number; plan_per_shift: number; gap_per_shift: number; downtime_per_shift: number; oee: number; paint_defect: number }; levers: Lever[]; note: string; reps: number }

const n1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString('ru-RU')
const int = (x: number) => Math.round(x).toLocaleString('ru-RU')

/** Оценка эффекта для завода (требование ТЗ): что даст внедрение — машины, ₸, минуты простоя, OEE, брак. */
export default function BusinessEffect() {
  const [d, setD] = useState<Effect | null>(null)
  const m = useMoney()
  useEffect(() => { fetch('/api/effect').then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => {}) }, [])
  if (!d) return <Card className="p-5 text-sm text-slate-500">Считаю эффект для завода…</Card>
  const act = d.levers.find((l) => l.cost)
  const ef = act ? money$(act.delta_per_shift, act.cost!, m, d.base.gap_per_shift) : null
  const shiftsMonth = m.days * m.shifts

  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><TrendingUp size={18} /></span>
          <div>
            <h2 className="text-lg font-semibold leading-tight">Эффект для завода</h2>
            <p className="text-sm text-slate-500">Что даст внедрение: машины, деньги, простои, OEE, брак. Сейчас: {n1(d.base.good_per_shift)} машин за смену при плане {d.base.plan_per_shift}.</p>
          </div>
        </div>
        <SourceBadge source="sim" />
      </div>

      {act && ef && (
        <div className="rounded-2xl bg-emerald-50/60 p-4 ring-1 ring-emerald-100">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-800">1 · {act.what}</div>
          <div className="mt-0.5 font-semibold">{act.name}</div>
          <div className="mt-2 grid gap-3 sm:grid-cols-4">
            <div><div className="text-2xl font-semibold tabular-nums text-emerald-700">+{n1(act.delta_per_shift)}</div><div className="text-xs text-slate-500">машин за смену · +{int(act.delta_per_shift * shiftsMonth)} в месяц</div></div>
            <div><div className="text-2xl font-semibold tabular-nums">{int(act.downtime_per_shift.before)} → {int(act.downtime_per_shift.after)}</div><div className="text-xs text-slate-500">мин простоя за смену (−{int(100 * (1 - act.downtime_per_shift.after / Math.max(1, act.downtime_per_shift.before)))}%)</div></div>
            <div><div className="text-2xl font-semibold tabular-nums">{int(act.oee.before)} → {int(act.oee.after)}%</div><div className="text-xs text-slate-500">OEE (цель 85%)</div></div>
            <div>
              <div className="text-2xl font-semibold tabular-nums">{tenge(ef.netYear)}</div>
              <div className="text-xs text-slate-500">в год чистыми{ef.paybackDays ? ` · окупаемость ≈ ${ef.paybackDays} раб. дн.` : ''}</div>
            </div>
          </div>
          <div className="mt-2 text-xs text-slate-600">
            {ef.mode === 'plan'
              ? <>Деньгами считаем только машины до плана: {tenge(ef.netMonth)} в месяц с учётом затрат ({tenge(act.cost!.month)}/мес{act.cost!.once ? `, разово ${tenge(act.cost!.once)}` : ''}). Сверх плана — ещё ≈ {tenge(ef.aboveMonth)} в месяц, если на машины есть спрос.</>
              : <>{tenge(ef.netMonth)} в месяц с учётом затрат ({tenge(act.cost!.month)}/мес{act.cost!.once ? `, разово ${tenge(act.cost!.once)}` : ''}); прирост сверх плана — если на машины есть спрос.</>}
            {' '}Точность прироста: {n1(act.ci[0])}…{n1(act.ci[1])} машин за смену.
          </div>
        </div>
      )}

      {d.levers.filter((l) => !l.cost).map((l, i) => (
        <div key={l.name} className="mt-3 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{(act ? 2 : 1) + i} · {l.what}</div>
          <div className="mt-0.5 font-semibold">{l.name}</div>
          <div className="mt-1 text-sm text-slate-700">
            Брак окраски сейчас {n1(l.paint_defect.before)}%. Если довести до нормы: <b>+{n1(l.delta_per_shift)} машины за смену</b> (≈ {tenge(Math.max(0, l.delta_per_shift) * shiftsMonth * m.margin)} в месяц), OEE {int(l.oee.before)} → {int(l.oee.after)}%.
            {l.delta_per_shift < 1 && ' Машин почти не прибавится: окраска не узкое место, переделки успевают. Выигрыш — в качестве: меньше кузовов с дефектом и меньше переделок.'}
          </div>
        </div>
      ))}

      <p className="mt-3 text-[11px] text-slate-400">{d.note} Маржа {tenge(m.margin)} с машины и {m.days} раб. дней × {m.shifts} смены — меняются в «Из чего считаем заработок». Затраты на действия — оценка (допущение).</p>
    </Card>
  )
}
