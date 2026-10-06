import { RotateCcw, Sparkles, Wallet } from 'lucide-react'
import { useEffect, useState } from 'react'
import { effect, marginOf, tenge, useMoney } from '../money'
import type { Money, WhatIf } from '../source'
import { Card, SourceBadge } from '../ui'
import { useView } from './store'

const n1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString('ru-RU')
const NONE: Money = { month: 0, once: 0 }

function Num({ label, value, onChange, unit, w = 'w-28' }: { label: string; value: number; onChange: (v: number) => void; unit?: string; w?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-500">
      {label && <span>{label}</span>}
      <span className="flex items-center gap-1.5">
        <input type="text" inputMode="numeric" value={value.toLocaleString('ru-RU')}
          onChange={(e) => { const v = Number(e.target.value.replace(/\D/g, '')); if (Number.isFinite(v)) onChange(v) }}
          className={`${w} rounded-lg bg-slate-50 px-2.5 py-1.5 text-sm font-medium tabular-nums text-slate-900 ring-1 ring-slate-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400`} />
        {unit && <span className="text-slate-400">{unit}</span>}
      </span>
    </label>
  )
}

/** Калькулятор эффекта: +машин из what-if × маржа − затраты. Маржа и затраты — допущения, меняются здесь. */
export default function MoneyCalc({ whatif }: { whatif: WhatIf | null }) {
  const cfg = useMoney()
  const ask = useView((v) => v.ask)
  const choices = whatif ? [
    ...(whatif.combo ? [{ id: 'combo', name: 'Лучшее решение', full: whatif.combo.names.join(' + '), delta: whatif.combo.delta_per_shift, ci: whatif.combo.ci95, money: whatif.combo.money ?? NONE }] : []),
    ...whatif.options.filter((o) => o.significant && o.delta_per_shift > 0).slice(0, 3)
      .map((o) => ({ id: o.id, name: o.name, full: o.name, delta: o.delta_per_shift, ci: o.ci95, money: o.money ?? NONE })),
  ] : []
  const [pick, setPick] = useState<string | null>(null)
  const cur = choices.find((c) => c.id === pick) ?? choices[0]
  const [cost, setCost] = useState<Money>(NONE)
  useEffect(() => { if (cur) setCost(cur.money) }, [cur?.id, whatif])   // eslint-disable-line react-hooks/exhaustive-deps

  if (!whatif || !cur) return null
  const e = effect(cur.delta, cost, cfg)
  const lo = effect(cur.ci[0], cost, cfg), hi = effect(cur.ci[1], cost, cfg)
  const gapMonth = whatif.gap_per_shift * e.shiftsMonth * cfg.margin

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Wallet size={18} /></span>
          <div>
            <h2 className="text-lg font-semibold leading-tight">Эффект в деньгах</h2>
            {gapMonth > 0 && <p className="text-sm text-slate-500">Недобор до плана стоит <b className="text-red-600">{tenge(gapMonth)}</b> в месяц</p>}
          </div>
        </div>
        <div className="flex items-center gap-1.5"><SourceBadge source="calc" /><SourceBadge source="assumption" /></div>
      </div>

      {/* что считаем */}
      <div className="mb-4 flex flex-wrap gap-2">
        {choices.map((c) => (
          <button key={c.id} onClick={() => setPick(c.id)} title={c.full}
            className={`max-w-[260px] truncate rounded-xl px-3 py-1.5 text-sm ring-1 transition ${cur.id === c.id ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'}`}>
            {c.name} <span className={cur.id === c.id ? 'text-emerald-300' : 'text-emerald-600'}>+{n1(c.delta)}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        {/* входные цифры */}
        <div className="space-y-3 rounded-2xl bg-slate-50/60 p-4 ring-1 ring-slate-100">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500">
              <th className="pb-1 font-normal">Модель</th><th className="pb-1 text-right font-normal">план/мес</th>
              <th className="pb-1 pl-3 font-normal">Цена</th><th className="pb-1 text-right font-normal">маржа</th>
            </tr></thead>
            <tbody>
              {cfg.models.map((m) => (
                <tr key={m.model}>
                  <td className="py-1 pr-2 font-medium text-slate-800">{m.model}</td>
                  <td className="py-1 text-right tabular-nums text-slate-500">{m.plan_month.toLocaleString('ru-RU')}</td>
                  <td className="py-1 pl-3"><Num label="" value={m.price} onChange={(v) => cfg.setPrice(m.model, v)} w="w-28" /></td>
                  <td className="py-1 text-right tabular-nums text-slate-700">{tenge(marginOf(m, cfg.pct))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-slate-200">
            <span className="text-slate-500">Средняя маржа с машины <span className="text-xs">(по плану моделей)</span></span>
            <b className="tabular-nums">{tenge(cfg.margin)}</b>
          </div>
          <div className="flex flex-wrap gap-3">
            <Num label="Маржа завода, % от цены" value={cfg.pct} onChange={(v) => cfg.set({ pct: Math.min(50, v) })} unit="%" w="w-14" />
            <Num label="Рабочих дней в месяц" value={cfg.days} onChange={(v) => cfg.set({ days: Math.min(31, v) })} w="w-16" />
            <Num label="Смен в день" value={cfg.shifts} onChange={(v) => cfg.set({ shifts: Math.min(3, v) })} w="w-14" />
          </div>
          <div className="flex flex-wrap gap-3">
            <Num label="Затраты в месяц" value={cost.month} onChange={(v) => setCost({ ...cost, month: v })} unit="₸" w="w-32" />
            <Num label="Разовые вложения" value={cost.once} onChange={(v) => setCost({ ...cost, once: v })} unit="₸" w="w-32" />
          </div>
          {!cfg.isDefault() && (
            <button onClick={cfg.reset} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"><RotateCcw size={12} />Вернуть допущения</button>
          )}
        </div>

        {/* результат */}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 rounded-2xl bg-gradient-to-br from-emerald-50 to-white p-4 ring-1 ring-emerald-200">
            <div className="text-xs font-medium text-emerald-700">Чистый эффект в месяц</div>
            <div className={`text-4xl font-semibold tracking-tight tabular-nums ${e.netMonth >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{e.netMonth >= 0 ? '+' : ''}{tenge(e.netMonth)}</div>
            <div className="mt-0.5 text-xs text-slate-500">в пределах {tenge(lo.netMonth)} … {tenge(hi.netMonth)} · +{Math.round(e.carsMonth).toLocaleString('ru-RU')} машин в месяц</div>
          </div>
          <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <div className="text-xs text-slate-500">За год</div>
            <div className={`text-2xl font-semibold tabular-nums ${e.netYear >= 0 ? 'text-slate-900' : 'text-red-600'}`}>{tenge(e.netYear)}</div>
            <div className="text-xs text-slate-400">с учётом вложений</div>
          </div>
          <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <div className="text-xs text-slate-500">Окупаемость</div>
            <div className="text-2xl font-semibold tabular-nums text-slate-900">
              {cost.once === 0 ? 'сразу' : e.paybackDays == null ? 'не окупается' : e.paybackDays <= cfg.days ? `${e.paybackDays} дн.` : `${n1(e.paybackDays / cfg.days)} мес.`}
            </div>
            <div className="text-xs text-slate-400">{cost.once === 0 ? 'без разовых вложений' : `вложения ${tenge(cost.once)}`}</div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-xs text-slate-400">Прирост машин — из симуляции (20 прогонов). Модели и план — из данных; цены — ориентир по рознице Казахстана, маржа % и затраты — допущения: впишите цифры Allur. Это эффект на модели, а не гарантия экономии на заводе.</p>
        <button onClick={() => ask(`Посчитай эффект в деньгах для «${cur.full}»: +${n1(cur.delta)} машин за смену, средняя маржа ${Math.round(cfg.margin).toLocaleString('ru-RU')} ₸ с машины (модели: ${cfg.models.map((m) => `${m.model} ${m.price.toLocaleString('ru-RU')} ₸`).join(', ')}; маржа ${cfg.pct}% цены), затраты ${cost.month.toLocaleString('ru-RU')} ₸ в месяц и ${cost.once.toLocaleString('ru-RU')} ₸ разово. Стоит ли внедрять и какие риски?`)}
          className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 hover:text-violet-900"><Sparkles size={13} />Стоит ли внедрять?</button>
      </div>
    </Card>
  )
}
