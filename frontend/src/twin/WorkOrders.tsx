import { Check, Play, Wrench } from 'lucide-react'
import { useEffect, useState } from 'react'
import { tenge, useMoney } from '../money'
import { Card, SourceBadge } from '../ui'
import { t as tr } from '../i18n'
import { useView } from './store'

interface Order {
  id: string; time: string; station_name: string; assets: string[]; alarm: string; cause: string
  impact: { minutes: number; cars: number; limits_output: boolean }; todo: string; role: string; deadline_min: number
  priority: 'high' | 'normal'; status: 'open' | 'progress' | 'done'
}

const n1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString('ru-RU')
const STATUS_TEXT = { open: 'открыт', progress: 'в работе', done: 'закрыт' }

/** Наряды на ремонт: тревога → причина → наряд (кому, что, срок, цена). Обновляются по ходу смены. */
export default function WorkOrders({ seed }: { seed: number }) {
  const scenario = useView((v) => v.scenario)
  const t = useView((v) => v.t)
  const step = Math.floor(t / 30)                 // пересчёт раз в 30 минут смены
  const money = useMoney()
  const [items, setItems] = useState<Order[] | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    fetch(`/api/workorders?scenario=${encodeURIComponent(scenario)}&seed=${seed}&t=${Math.min(960, (step + 1) * 30)}`)
      .then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive && d) setItems(d.items) }).catch(() => {})
    return () => { alive = false }
  }, [scenario, seed, step, tick])

  const setStatus = async (id: string, status: Order['status']) => {
    await fetch(`/api/workorders/${encodeURIComponent(id)}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }).catch(() => {})
    setTick((x) => x + 1)
  }

  const open = items?.filter((o) => o.status !== 'done') ?? []
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold"><Wrench size={16} className="text-slate-500" />{tr('Наряды на ремонт')}
          {open.length > 0 && <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] text-white">{open.length}</span>}</div>
        <SourceBadge source="sim" />
      </div>
      {!items ? <div className="text-sm text-slate-400">…</div> : items.length === 0 ? (
        <div className="text-sm text-slate-500">{tr('Остановок пока не было — нарядов нет.')}</div>
      ) : (
        <ul className="space-y-2">
          {items.slice(0, 4).map((o) => (
            <li key={o.id} className={`rounded-2xl p-3 ring-1 ${o.status === 'done' ? 'bg-slate-50 opacity-60 ring-slate-100' : o.priority === 'high' ? 'bg-red-50/50 ring-red-100' : 'bg-white ring-slate-200'}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <div className="text-sm font-semibold">
                  <span className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${o.priority === 'high' ? 'bg-red-500' : 'bg-amber-500'}`} />
                  {o.alarm}
                </div>
                <div className="text-xs tabular-nums text-slate-500">
                  {o.impact.cars > 0.05 && <>−{n1(o.impact.cars)} маш. ≈ {tenge(o.impact.cars * money.margin)}</>}
                  {o.impact.limits_output && <span className="ml-1.5 text-violet-700">узкое место</span>}
                </div>
              </div>
              <div className="mt-1 text-xs text-slate-600"><span className="text-slate-400">{tr('Причина')}:</span> {o.cause}{o.assets.length > 0 && ` · ${o.assets.join(', ')}`}</div>
              <div className="mt-0.5 text-sm text-slate-800"><span className="text-xs text-slate-400">{tr('Наряд')}:</span> {o.todo}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-500">{o.role} · {tr('срок')} {o.deadline_min} {tr('мин')}</span>
                <span className="ml-auto flex gap-1.5">
                  {o.status === 'open' && <button onClick={() => setStatus(o.id, 'progress')} className="flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 font-medium text-white hover:bg-slate-700"><Play size={12} />{tr('В работу')}</button>}
                  {o.status !== 'done' && <button onClick={() => setStatus(o.id, 'done')} className="flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"><Check size={12} />{tr('Закрыть')}</button>}
                  {o.status !== 'open' && <span className="rounded-lg px-2 py-1 text-slate-500">{tr(STATUS_TEXT[o.status])}</span>}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {items && items.length > 4 && <div className="mt-2 text-xs text-slate-400">+{items.length - 4}</div>}
    </Card>
  )
}
