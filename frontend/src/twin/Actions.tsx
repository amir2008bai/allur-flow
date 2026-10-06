import { Box, Check, ChevronDown, CircleCheck, Columns2, Factory, Plus, Sparkles, Target, Wallet } from 'lucide-react'
import { useState } from 'react'
import type { WhatIf } from '../source'
import { effect, tenge, useMoney } from '../money'
import { Card } from '../ui'
import { parseCfg, toCfg } from './ShiftBuilder'
import { useView } from './store'

const n1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString('ru-RU')

/** «Что сделать, чтобы выполнить план»: разрыв до плана → полезные действия → лучшая пара. */
export default function Actions({ whatif, onFutures }: { whatif: WhatIf | null; onFutures: (id: string) => void }) {
  const [more, setMore] = useState(false)
  const ask = useView((v) => v.ask)
  const money = useMoney()
  const scenario = useView((v) => v.scenario)
  const setScenario = useView((v) => v.setScenario)
  const cfg = parseCfg(scenario)
  const inSim = (id: string) => cfg.actions.includes(id)
  const toggleSim = (ids: string[]) => { const all = ids.every(inSim); const acts = all ? cfg.actions.filter((a) => !ids.includes(a)) : [...new Set([...cfg.actions, ...ids])]; setScenario(toCfg(cfg.faults, acts)); document.getElementById('shift-builder')?.scrollIntoView({ behavior: 'smooth' }) }
  if (!whatif) return <div className="text-sm text-slate-500">Сравниваю 6 действий на 20 прогонах…</div>
  const useful = whatif.options.filter((o) => o.significant && o.delta_per_shift > 0)
  const rest = whatif.options.filter((o) => !(o.significant && o.delta_per_shift > 0))
  const gap = whatif.gap_per_shift
  const now = whatif.baseline.good_per_shift
  const combo = whatif.combo

  return (
    <div>
      {/* разрыв до плана */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Как выполнить план</h2>
          <p className="text-sm text-slate-500">
            План {whatif.plan_per_shift} машин за смену · сейчас {n1(now)} ·{' '}
            {gap > 0.5 ? <b className="text-red-600">не хватает {n1(gap)}</b> : <b className="text-emerald-600">план выполняется</b>}
          </p>
        </div>
        <button onClick={() => ask(`Что ещё можно сделать на линии, чтобы выпускать больше машин за смену? Сейчас ${n1(now)} при плане ${whatif.plan_per_shift}.`)}
          className="flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-sm font-medium text-violet-700 shadow-sm ring-1 ring-violet-200 hover:bg-violet-50">
          <Sparkles size={15} />Спросить ИИ
        </button>
      </div>

      {/* лучшая пара — главный ответ */}
      {combo && (
        <Card className="mb-4 overflow-hidden ring-2 ring-emerald-400">
          <div className="flex flex-wrap items-center gap-4 bg-gradient-to-r from-emerald-50 to-white px-5 py-4">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-600 text-white"><Target size={20} /></span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Лучшее решение</div>
              <div className="font-semibold">{combo.names.join(' + ')}</div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-semibold tabular-nums text-emerald-600">+{n1(combo.delta_per_shift)}</div>
              <div className="text-xs text-slate-500">машин за смену{combo.money ? ` · ≈ ${tenge(effect(combo.delta_per_shift, combo.money, money, gap).netMonth)} в месяц` : ''}</div>
            </div>
            {combo.closes_gap && <span className="flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white"><CircleCheck size={14} />план выполнен</span>}
            <button onClick={() => toggleSim(combo.ids)} className="flex items-center gap-1 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700">{combo.ids.every(inSim) ? <><Check size={13} />В смене</> : <><Plus size={13} />Добавить в смену</>}</button>
          </div>
        </Card>
      )}

      {useful.length === 0 ? (
        <Card className="p-5 text-sm text-slate-600">В этой смене серьёзных потерь нет — ни одно из 6 действий не даёт заметного прироста.</Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {useful.slice(0, 3).map((o) => (
            <Card key={o.id} className="flex flex-col p-5">
              <div className="font-semibold">{o.name}</div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-4xl font-semibold tracking-tight text-emerald-600">+{n1(o.delta_per_shift)}</span>
                <span className="text-sm text-slate-500">машин за смену</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">точно в пределах {n1(o.ci95[0])}…{n1(o.ci95[1])}{o.closes_gap ? ' · план выполнен' : ''}</div>
              <div className="mt-3 flex-1 space-y-2.5 text-sm">
                <div><div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><Factory size={12} />На заводе</div><div className="text-slate-700">{o.do || o.detail}</div></div>
                {o.changes && o.changes.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><Box size={12} />В двойнике</div>
                    <ul className="mt-0.5 space-y-0.5">
                      {o.changes.slice(0, 3).map((c) => (
                        <li key={c.what} className="flex items-baseline justify-between gap-2 text-slate-600">
                          <span className="truncate">{c.what}</span>
                          <span className="shrink-0 tabular-nums"><span className="text-slate-400">{String(c.before).replace('.', ',')}</span> → <b className="text-slate-900">{String(c.after).replace('.', ',')}</b> {c.unit}</span>
                        </li>
                      ))}
                      {o.changes.length > 3 && <li className="text-xs text-slate-400">ещё {o.changes.length - 3} параметра</li>}
                    </ul>
                  </div>
                )}
                {o.cost && <div className="flex items-center gap-1.5 text-xs text-slate-500"><Wallet size={12} />{o.cost}</div>}
              </div>
              <div className="mt-3 flex flex-wrap gap-3">
                <button onClick={() => toggleSim([o.id])} className="flex items-center gap-1 text-xs font-semibold text-slate-700 hover:text-slate-950">{inSim(o.id) ? <><Check size={13} />В смене</> : <><Plus size={13} />Добавить в смену</>}</button>
                <button onClick={() => onFutures(o.id)} className="flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-900"><Columns2 size={13} />Два будущих</button>
                <button onClick={() => ask(`Почему «${o.name}» даёт +${n1(o.delta_per_shift)} машин за смену и как это внедрить на линии?`)} className="flex items-center gap-1 text-xs font-semibold text-violet-700 hover:text-violet-900"><Sparkles size={13} />Почему?</button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {rest.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setMore(!more)} className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800">
            <ChevronDown size={14} className={`transition ${more ? 'rotate-180' : ''}`} />{more ? 'Скрыть' : `Ещё ${rest.length} — в этой смене не помогают`}
          </button>
          {more && (
            <div className="mt-2 divide-y divide-slate-100 rounded-xl bg-white ring-1 ring-slate-200">
              {rest.map((o) => (
                <div key={o.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span>{o.name}</span>
                  <span className="tabular-nums text-slate-400">{o.delta_per_shift >= 0 ? '+' : ''}{n1(o.delta_per_shift)} · эффект не подтверждён</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <p className="mt-3 text-xs text-slate-400">Оценка на 20 одинаковых прогонах симуляции. Цифры «было» — допущения модели (время цикла, ремонта); после загрузки реальных данных они заменятся фактическими, и расчёт пересчитается.</p>
    </div>
  )
}
