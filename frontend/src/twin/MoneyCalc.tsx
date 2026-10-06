import { ChevronDown, RotateCcw, Sparkles, Wallet } from 'lucide-react'
import { useEffect, useState } from 'react'
import { effect, marginOf, tenge, useMoney } from '../money'
import type { Money, WhatIf } from '../source'
import { Card, SourceBadge } from '../ui'
import { useView } from './store'

const n1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString('ru-RU')
const int = (x: number) => Math.round(x).toLocaleString('ru-RU')
const NONE: Money = { month: 0, once: 0 }
const cars = (x: number) => { const n = Math.round(x), d = n % 10, h = n % 100; return `${n.toLocaleString('ru-RU')} ${d === 1 && h !== 11 ? 'машина' : d >= 2 && d <= 4 && (h < 12 || h > 14) ? 'машины' : 'машин'}` }

function Num({ label, value, onChange, unit, w = 'w-28' }: { label: string; value: number; onChange: (v: number) => void; unit?: string; w?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-500">
      {label && <span>{label}</span>}
      <span className="flex items-center gap-1.5">
        <input type="text" inputMode="numeric" value={value.toLocaleString('ru-RU')}
          onChange={(e) => { const v = Number(e.target.value.replace(/\D/g, '')); if (Number.isFinite(v)) onChange(v) }}
          className={`${w} rounded-lg bg-white px-2.5 py-1.5 text-sm font-medium tabular-nums text-slate-900 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400`} />
        {unit && <span className="text-slate-400">{unit}</span>}
      </span>
    </label>
  )
}

/** Сколько денег даст действие. Пока план не выполняется — считаем только машины ДО плана (их точно продадут). */
export default function MoneyCalc({ whatif }: { whatif: WhatIf | null }) {
  const cfg = useMoney()
  const ask = useView((v) => v.ask)
  const [open, setOpen] = useState(false)
  const choices = whatif ? [
    ...(whatif.combo ? [{ id: 'combo', name: (whatif.combo.shorts ?? whatif.combo.names).join(' + '), full: whatif.combo.names.join(' + '), best: true, delta: whatif.combo.delta_per_shift, money: whatif.combo.money ?? NONE }] : []),
    ...whatif.options.filter((o) => o.significant && o.delta_per_shift > 0).slice(0, 3)
      .map((o) => ({ id: o.id, name: o.short ?? o.name, full: o.name, best: false, delta: o.delta_per_shift, money: o.money ?? NONE })),
  ] : []
  const [pick, setPick] = useState<string | null>(null)
  const cur = choices.find((c) => c.id === pick) ?? choices[0]
  const [cost, setCost] = useState<Money>(NONE)
  useEffect(() => { if (cur) setCost(cur.money) }, [cur?.id, whatif])   // eslint-disable-line react-hooks/exhaustive-deps

  if (!whatif || !cur) return null
  const gap = whatif.gap_per_shift
  const e = effect(cur.delta, cost, cfg, gap)
  const gapCars = gap * e.shiftsMonth
  const payback = cost.once === 0 ? 'сразу' : e.paybackDays == null ? 'не окупается' : e.paybackDays <= cfg.days ? `${e.paybackDays} дн.` : `${n1(e.paybackDays / cfg.days)} мес.`

  return (
    <Card className="p-5">
      {/* заголовок: сколько стоит недобор */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Wallet size={18} /></span>
          <div>
            <h2 className="text-lg font-semibold leading-tight">Эффект в деньгах</h2>
            <p className="text-sm text-slate-500">
              {e.mode === 'plan'
                ? <>Сейчас до плана не хватает <b className="text-red-600">{cars(gapCars)} в месяц</b> — теряем {tenge(gapCars * cfg.margin)} маржи</>
                : <>План выполняется — считаем машины сверх плана</>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5"><SourceBadge source="calc" /><SourceBadge source="assumption" /></div>
      </div>

      {/* для какого действия */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-500">Что сделать <span className="text-xs text-slate-400">(+ машин за смену)</span>:</span>
        {choices.map((c) => {
          const on = cur.id === c.id
          return (
            <button key={c.id} onClick={() => setPick(c.id)} title={`${c.full}: +${n1(c.delta)} машин за смену`}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm ring-1 transition ${on ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'}`}>
              {c.best && <span className={`rounded-md px-1.5 text-[10px] font-semibold uppercase ${on ? 'bg-emerald-500 text-white' : 'bg-emerald-50 text-emerald-700'}`}>лучшее</span>}
              {c.name}
              <span className={on ? 'text-emerald-300' : 'text-emerald-600'}>+{n1(c.delta)}</span>
            </button>
          )
        })}
      </div>

      {/* результат */}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-2xl bg-gradient-to-br from-emerald-50 to-white p-4 ring-1 ring-emerald-200">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-medium text-emerald-700">{e.mode === 'plan' ? 'Дополнительно заработаем в месяц' : 'Сверх плана заработаем в месяц'}</div>
            {e.mode === 'plan' && (e.closesGap
              ? <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white">закрывает весь недобор</span>
              : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">закрывает {int(e.cars)} из {int(gapCars)}</span>)}
          </div>
          <div className={`text-4xl font-semibold tracking-tight tabular-nums ${e.netMonth >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{e.netMonth >= 0 ? '+' : ''}{tenge(e.netMonth)}</div>
          <div className="mt-1 text-sm tabular-nums text-slate-600">
            +{cars(e.cars)}{e.mode === 'plan' ? ' до плана' : ''} × {tenge(cfg.margin)}{cost.month > 0 && <> − {tenge(cost.month)} затрат</>}
          </div>
          {e.mode === 'extra' && <div className="mt-1 text-xs text-slate-400">если на эти машины будет спрос</div>}
          {e.aboveMonth > 0 && <div className="mt-1.5 text-xs text-slate-400">ещё +{cars(e.aboveMonth / cfg.margin)} сверх плана (+{tenge(e.aboveMonth)}) — если будет спрос</div>}
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <div className="text-xs text-slate-500">За год</div>
          <div className={`text-2xl font-semibold tabular-nums ${e.netYear >= 0 ? 'text-slate-900' : 'text-red-600'}`}>{tenge(e.netYear)}</div>
          <div className="text-xs text-slate-400">с учётом вложений</div>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <div className="text-xs text-slate-500">Окупаемость</div>
          <div className="text-2xl font-semibold tabular-nums text-slate-900">{payback}</div>
          <div className="text-xs text-slate-400">{cost.once === 0 ? 'без разовых вложений' : `вложения ${tenge(cost.once)}`}</div>
        </div>
      </div>

      {/* из чего считаем — свёрнуто */}
      <div className="mt-3 rounded-2xl bg-slate-50/70 ring-1 ring-slate-100">
        <button onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left text-sm">
          <span className="font-medium text-slate-700">Из чего считаем</span>
          <span className="text-slate-500">маржа {tenge(cfg.margin)} с машины · затраты {tenge(cost.month)}/мес{cost.once > 0 ? ` · вложения ${tenge(cost.once)}` : ''} · {e.shiftsMonth} смены в месяц</span>
          <span className="ml-auto flex items-center gap-1 text-xs font-medium text-slate-500">{open ? 'Свернуть' : 'Изменить'}<ChevronDown size={14} className={`transition ${open ? 'rotate-180' : ''}`} /></span>
        </button>
        {open && (
          <div className="grid gap-5 border-t border-slate-100 px-4 py-4 lg:grid-cols-2">
            <div>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-slate-500">
                  <th className="pb-1 font-normal">Модель</th><th className="pb-1 text-right font-normal">план/мес</th>
                  <th className="pb-1 pl-3 font-normal">Цена, ₸</th><th className="pb-1 text-right font-normal">маржа</th>
                </tr></thead>
                <tbody>
                  {cfg.models.map((m) => (
                    <tr key={m.model}>
                      <td className="py-1 pr-2 font-medium text-slate-800">{m.model}</td>
                      <td className="py-1 text-right tabular-nums text-slate-500">{int(m.plan_month)}</td>
                      <td className="py-1 pl-3"><Num label="" value={m.price} onChange={(v) => cfg.setPrice(m.model, v)} w="w-28" /></td>
                      <td className="py-1 text-right tabular-nums text-slate-700">{tenge(marginOf(m, cfg.pct))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-xs text-slate-400">План моделей — из данных. Средняя маржа взвешена по плану.</p>
            </div>
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3">
                <Num label="Маржа завода, % цены" value={cfg.pct} onChange={(v) => cfg.set({ pct: Math.min(50, v) })} unit="%" w="w-14" />
                <Num label="Рабочих дней" value={cfg.days} onChange={(v) => cfg.set({ days: Math.min(31, v) })} w="w-14" />
                <Num label="Смен в день" value={cfg.shifts} onChange={(v) => cfg.set({ shifts: Math.min(3, v) })} w="w-14" />
              </div>
              <div className="flex flex-wrap gap-3">
                <Num label="Затраты в месяц" value={cost.month} onChange={(v) => setCost({ ...cost, month: v })} unit="₸" w="w-32" />
                <Num label="Разовые вложения" value={cost.once} onChange={(v) => setCost({ ...cost, once: v })} unit="₸" w="w-32" />
              </div>
              {!cfg.isDefault() && <button onClick={cfg.reset} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"><RotateCcw size={12} />Вернуть исходные цифры</button>}
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-xs text-slate-400">Прирост машин — из симуляции. Цены — ориентир по рознице Казахстана, маржа и затраты — допущения: впишите цифры Allur. Это оценка на модели, а не гарантия.</p>
        <button onClick={() => ask(`Стоит ли внедрять «${cur.full}»? Даёт +${n1(cur.delta)} машин за смену, до плана не хватает ${n1(gap)} за смену. Средняя маржа ${int(cfg.margin)} ₸ с машины, затраты ${int(cost.month)} ₸ в месяц и ${int(cost.once)} ₸ разово. Какие риски?`)}
          className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 hover:text-violet-900"><Sparkles size={13} />Стоит ли внедрять?</button>
      </div>
    </Card>
  )
}
