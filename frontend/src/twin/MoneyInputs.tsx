import { ChevronDown, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { marginOf, tenge, useMoney } from '../money'

export function Num({ label, value, onChange, unit, w = 'w-28' }: { label: string; value: number; onChange: (v: number) => void; unit?: string; w?: string }) {
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

/** «Из чего считаем заработок»: модели (план — из данных), цены, маржа %. Свёрнуто в одну строку. */
export default function MoneyInputs({ compact = false }: { compact?: boolean }) {
  const cfg = useMoney()
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-2xl bg-slate-50/70 ring-1 ring-slate-100">
      <button aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left text-sm">
        <span className="font-medium text-slate-700">Настройки денег</span>
        <span className="text-slate-500">{cfg.pct}% цены · {tenge(cfg.margin)} с машины</span>
        <span className="ml-auto flex items-center gap-1 text-xs font-medium text-slate-500">{open ? 'Свернуть' : 'Изменить'}<ChevronDown size={14} className={`transition ${open ? 'rotate-180' : ''}`} /></span>
      </button>
      {open && (
        <div className={`grid gap-3 border-t border-slate-100 px-4 py-3 ${compact ? "" : "lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"}`}>
          <div>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500">
                <th className="pb-1 font-normal">Модель</th><th className="pb-1 text-right font-normal">план/мес</th>
                <th className="pb-1 pl-3 font-normal">Цена, ₸</th><th className="hidden pb-1 text-right font-normal sm:table-cell">с машины</th>
              </tr></thead>
              <tbody>
                {cfg.models.map((m) => (
                  <tr key={m.model}>
                    <td className="py-1 pr-2 font-medium text-slate-800">{m.model}</td>
                    <td className="py-1 text-right tabular-nums text-slate-500">{m.plan_month.toLocaleString('ru-RU')}</td>
                    <td className="py-1 pl-3"><Num label="" value={m.price} onChange={(v) => cfg.setPrice(m.model, v)} w="w-28" /></td>
                    <td className="hidden py-1 text-right tabular-nums text-slate-700 sm:table-cell">{tenge(marginOf(m, cfg.pct))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-xs text-slate-400">Модели и план — из данных завода. Цены — ориентир по рознице Казахстана.</p>
          </div>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <Num label="Доход с машины, %" value={cfg.pct} onChange={(v) => cfg.set({ pct: Math.min(50, v) })} unit="%" w="w-14" />
              <Num label="Рабочих дней в месяц" value={cfg.days} onChange={(v) => cfg.set({ days: Math.min(31, v) })} w="w-14" />
              <Num label="Смен в день" value={cfg.shifts} onChange={(v) => cfg.set({ shifts: Math.min(3, v) })} w="w-14" />
            </div>
            <p className="text-xs text-slate-400">Маржа — оценка дохода с одной машины после основных затрат. Впишите цифры Allur — все суммы обновятся.</p>
            {!cfg.isDefault() && <button onClick={cfg.reset} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"><RotateCcw size={12} />Вернуть исходные цифры</button>}
          </div>
        </div>
      )}
    </div>
  )
}
