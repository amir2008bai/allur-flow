import { ArrowRight, Loader2, RotateCcw, TriangleAlert, Wrench } from 'lucide-react'
import { useEffect, useState } from 'react'
import { tenge, useMoney } from '../money'
import { Card, SourceBadge } from '../ui'
import MoneyInputs from './MoneyInputs'
import { useView } from './store'

interface Opt { id: string; short: string; name: string; detail: string; do?: string; money?: { month: number; once: number } }
interface Side { good_per_shift: number; lo: number; hi: number; oee_pct: number; downtime_min: number; paint_defect_pct: number; delta?: number; delta_ci?: [number, number] }
interface Shift { plan_per_shift: number; normal: Side; forecast: Side; actions: { id: string; cost_per_shift: number; once: number }[]; reps: number
  twin?: { learned: boolean; paint_defect_p: number; observations: number; version: string } }

/** Сценарий двойника: cfg:<сбои>|<действия>. Старые имена переводим в новый вид. */
export function parseCfg(s: string): { faults: string[]; actions: string[] } {
  if (s.startsWith('cfg:')) { const [f, a] = s.slice(4).split('|'); return { faults: f ? f.split(',') : [], actions: a ? a.split(',') : [] } }
  if (s.startsWith('chaos:')) return { faults: s.slice(6).split(','), actions: [] }
  if (s.startsWith('stress:')) return { faults: [s.slice(7)], actions: [] }
  if (s === 'paint_degradation') return { faults: ['filter_clog'], actions: [] }
  if (s === 'conveyor_break') return { faults: ['conveyor_break'], actions: [] }
  return { faults: [], actions: [] }
}
export const toCfg = (faults: string[], actions: string[]) => (faults.length || actions.length ? `cfg:${faults.join(',')}|${actions.join(',')}` : 'base')

const int = (x: number) => Math.round(x).toLocaleString('ru-RU')
const sign = (x: number) => (x > 0 ? '+' : x < 0 ? '−' : '')
const cars = (x: number) => { const n = Math.abs(Math.round(x)), d = n % 10, h = n % 100; return `${n.toLocaleString('ru-RU')} ${d === 1 && h !== 11 ? 'машина' : d >= 2 && d <= 4 && (h < 12 || h > 14) ? 'машины' : 'машин'}` }

function Chip({ on, onClick, tone, title, children }: { on: boolean; onClick: () => void; tone: 'bad' | 'good'; title: string; children: React.ReactNode }) {
  const onCls = tone === 'bad' ? 'bg-red-600 text-white ring-red-600' : 'bg-emerald-600 text-white ring-emerald-600'
  return (
    <button onClick={onClick} title={title}
      className={`rounded-xl px-3 py-1.5 text-sm ring-1 transition active:scale-[.97] ${on ? onCls : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'}`}>
      {children}
    </button>
  )
}

/** Смена: план → обычная смена (симуляция) → прогноз с выбранными сбоями и действиями. Машины и заработок за смену. */
export default function ShiftBuilder() {
  const scenario = useView((v) => v.scenario)
  const setScenario = useView((v) => v.setScenario)
  const money = useMoney()
  const { faults, actions } = parseCfg(scenario)
  const [opts, setOpts] = useState<{ faults: Opt[]; actions: Opt[] } | null>(null)
  const [data, setData] = useState<Shift | null>(null)
  const [busy, setBusy] = useState(false)
  const [faultOnly, setFaultOnly] = useState<number | null>(null)   // машин за смену только со сбоями — чтобы показать вклад действий

  useEffect(() => { fetch('/api/sim/options').then((r) => r.json()).then(setOpts).catch(() => setOpts({ faults: [], actions: [] })) }, [])
  useEffect(() => {
    if (!scenario.startsWith('cfg:') && scenario !== 'base') { setScenario(toCfg(faults, actions)); return }   // старое имя → новый вид
    let alive = true
    setBusy(true)
    fetch(`/api/sim/shift?faults=${faults.join(',')}&actions=${actions.join(',')}`).then((r) => r.json())
      .then((d) => { if (alive) setData(d) }).catch(() => {}).finally(() => alive && setBusy(false))
    if (faults.length && actions.length) {
      fetch(`/api/sim/shift?faults=${faults.join(',')}`).then((r) => r.json()).then((d) => { if (alive) setFaultOnly(d.forecast.good_per_shift) }).catch(() => {})
    } else setFaultOnly(null)
    return () => { alive = false }
  }, [scenario])   // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  const touched = faults.length + actions.length > 0
  const m = money.margin
  const shiftsMonth = money.days * money.shifts

  const plan = data?.plan_per_shift ?? 120
  const normal = data?.normal
  const fc = data?.forecast
  const costShift = data?.actions.reduce((s, a) => s + a.cost_per_shift, 0) ?? 0
  const once = data?.actions.reduce((s, a) => s + a.once, 0) ?? 0
  const earnNormal = normal ? normal.good_per_shift * m : 0
  const earnFc = fc ? fc.good_per_shift * m - costShift : 0
  const R = Math.round   // машины считаем целыми, чтобы разницы складывались
  const dCars = fc && normal ? R(fc.good_per_shift) - R(normal.good_per_shift) : 0
  const dEarn = earnFc - earnNormal
  const tone = !touched || Math.abs(dCars) < 0.5 ? 'neutral' : dCars < 0 ? 'bad' : 'good'

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold leading-tight">Смена: план и прогноз</h2>
          <p className="text-sm text-slate-500">Одна смена — 8 часов. Включайте сбои и действия — прогноз машин и заработка пересчитается.</p>
        </div>
        {busy && <span className="flex items-center gap-1.5 text-xs text-slate-400"><Loader2 size={14} className="animate-spin" />считаю {data?.reps ?? 20} смен…</span>}
      </div>

      {/* три числа: план → обычная → прогноз */}
      <div className="grid items-stretch gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1.3fr)]">
        <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
          <div className="flex items-center justify-between text-xs text-slate-500">План смены <SourceBadge source="fact" /></div>
          <div className="mt-1 text-3xl font-semibold tabular-nums">{cars(plan)}</div>
          <div className="text-sm tabular-nums text-slate-600">{tenge(plan * m)} заработка</div>
          <div className="mt-1 text-xs text-slate-400">из данных завода</div>
        </div>
        <ArrowRight className="hidden self-center text-slate-300 md:block" size={20} />
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <div className="flex items-center justify-between text-xs text-slate-500">Обычная смена <SourceBadge source="sim" /></div>
          <div className="mt-1 text-3xl font-semibold tabular-nums">{normal ? cars(normal.good_per_shift) : '…'}</div>
          <div className="text-sm tabular-nums text-slate-600">{normal ? `${tenge(earnNormal)} заработка` : ' '}</div>
          <div className="mt-1 text-xs text-slate-400">{normal ? `без сбоев · обычно ${int(normal.lo)}–${int(normal.hi)} · OEE ${int(normal.oee_pct)}%` : ''}</div>
        </div>
        <ArrowRight className="hidden self-center text-slate-300 md:block" size={20} />
        <div className={`rounded-2xl p-4 ring-1 ${tone === 'bad' ? 'bg-red-50/60 ring-red-200' : tone === 'good' ? 'bg-emerald-50/70 ring-emerald-200' : 'bg-white ring-slate-200'}`}>
          <div className="flex items-center justify-between text-xs text-slate-500">Прогноз с вашими настройками <SourceBadge source="sim" /></div>
          {!touched ? (
            <div className="mt-2 text-sm text-slate-500">Сейчас — обычная смена. Выберите ниже сбой или действие, чтобы увидеть, что изменится.</div>
          ) : fc ? (
            <>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
                <span className="text-3xl font-semibold tabular-nums">{cars(fc.good_per_shift)}</span>
                <span className={`text-base font-semibold tabular-nums ${tone === 'bad' ? 'text-red-600' : tone === 'good' ? 'text-emerald-600' : 'text-slate-500'}`}>{sign(dCars)}{cars(dCars)}</span>
              </div>
              <div className="text-sm tabular-nums text-slate-600">
                {tenge(earnFc)} заработка{' '}
                <b className={dEarn < 0 ? 'text-red-600' : 'text-emerald-600'}>{dEarn >= 0 ? '+' : ''}{tenge(dEarn)}</b>
              </div>
              {faultOnly != null && normal && (
                <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs font-medium tabular-nums">
                  <span className="text-red-600">сбои {sign(R(faultOnly) - R(normal.good_per_shift))}{cars(R(faultOnly) - R(normal.good_per_shift))}</span>
                  <span className="text-emerald-700">действия вернули {sign(R(fc.good_per_shift) - R(faultOnly))}{cars(R(fc.good_per_shift) - R(faultOnly))}</span>
                </div>
              )}
              <div className="mt-1 text-xs text-slate-500">
                план {int(100 * fc.good_per_shift / plan)}% · OEE {int(fc.oee_pct)}% · если так каждую смену: {dEarn >= 0 ? "+" : ""}{tenge(dEarn * shiftsMonth)} в месяц
                {costShift > 0 && ` · затраты действий учтены${once > 0 ? `, разово ${tenge(once)}` : ''}`}
              </div>
            </>
          ) : <div className="mt-2 text-sm text-slate-400">считаю…</div>}
        </div>
      </div>

      {/* настройки симуляции */}
      <div className="mt-4 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex w-24 items-center gap-1.5 text-sm font-medium text-slate-600"><TriangleAlert size={15} className="text-red-500" />Сбои</span>
          {opts?.faults.map((f) => (
            <Chip key={f.id} on={faults.includes(f.id)} tone="bad" title={f.detail} onClick={() => setScenario(toCfg(toggle(faults, f.id), actions))}>{f.short}</Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex w-24 items-center gap-1.5 text-sm font-medium text-slate-600"><Wrench size={15} className="text-emerald-600" />Действия</span>
          {opts?.actions.map((a) => (
            <Chip key={a.id} on={actions.includes(a.id)} tone="good" title={`${a.do ?? a.detail}${a.money ? ` · ${a.money.month ? `${tenge(a.money.month)}/мес` : ''}${a.money.month && a.money.once ? ', ' : ''}${a.money.once ? `${tenge(a.money.once)} разово` : ''}` : ''}`}
              onClick={() => setScenario(toCfg(faults, toggle(actions, a.id)))}>{a.short}</Chip>
          ))}
          {touched && <button onClick={() => setScenario('base')} className="ml-1 flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800"><RotateCcw size={12} />Обычная смена</button>}
        </div>
      </div>

      <div className="mt-4"><MoneyInputs /></div>
      {data?.twin?.learned && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700"><SourceBadge source="feedback" />Двойник учитывает брак окраски {(100 * data.twin.paint_defect_p).toFixed(1).replace('.', ',')}% — уточнён вводом людей и камерой ({data.twin.observations} набл.)</p>
      )}
      <p className="mt-2 text-xs text-slate-400">Прогноз — среднее по {data?.reps ?? 20} симуляциям смены с одинаковыми случайными событиями: разница возникает только из-за ваших настроек.</p>
    </Card>
  )
}
