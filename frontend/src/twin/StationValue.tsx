import { Timer } from 'lucide-react'
import { useEffect, useState } from 'react'
import { tenge, useMoney } from '../money'
import { Card, SourceBadge } from '../ui'
import { t } from '../i18n'
import { journalRequest } from './journalRequest'
import MoneyInputs from './MoneyInputs'

interface Row { station: string; name: string; loss_per_hour: number; loss_ci: [number, number]; loss_per_min: number; gain_per_hour: number; gain_ci: [number, number]; limits_output: boolean }
interface Value { stations: Row[]; constraint: string | null; reps: number; gain_reps: number; method: string }
const n1 = (x: number) => x.toFixed(1).replace('.', ',')

export default function StationValue() {
  const [d, setD] = useState<Value | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [station, setStation] = useState('assembly')
  const [minutes, setMinutes] = useState(30)
  const [saving, setSaving] = useState(false)
  const money = useMoney()
  useEffect(() => {
    const controller = new AbortController()
    setError(null)
    journalRequest<Value>('/api/sim/station_value', { signal: controller.signal })
      .then(data => { if (!data.stations?.length) throw new Error('Нет расчёта участков.'); setD(data) })
      .catch((e: Error) => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [tick])
  if (!d) return <Card className="p-5 text-sm text-slate-500">{error ? <><span role="alert">{error}</span><button onClick={() => setTick(x => x + 1)} className="ml-3 font-medium text-slate-900">Повторить</button></> : 'Считаю потери от простоя…'}</Card>
  const rows = [...d.stations].sort((a, b) => b.loss_per_min - a.loss_per_min)
  const row = d.stations.find(r => r.station === station) ?? rows[0]
  const cars = row.loss_per_min * minutes
  const amount = cars * money.margin
  const changeMinutes = (v: number) => setMinutes(Math.max(0, Math.min(60, Number.isFinite(v) ? v : 0)))
  return <Card className="p-4 sm:p-5">
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><Timer size={18} />{t('Простой и деньги')}</h2><SourceBadge source="sim" />
    </div>
    <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Участок для расчёта простоя">
      {d.stations.map(r => <button key={r.station} aria-pressed={station === r.station} onClick={() => setStation(r.station)} className={`rounded-xl px-3 py-2 text-sm font-medium ${station === r.station ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}>{r.name}</button>)}
      <button aria-pressed={saving} onClick={() => setSaving(!saving)} className="ml-auto rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">{saving ? 'Сокращаем простой' : 'Считаем потери'} ⇄</button>
    </div>
    <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="rounded-2xl bg-slate-50 p-3">
        <div className="flex items-center justify-between gap-2"><label htmlFor="downtime-minutes" className="text-sm text-slate-600">{saving ? 'Убрать минут простоя' : 'Минут простоя'}</label><input id="downtime-minutes" type="number" min={0} max={60} step={1} value={minutes} onChange={e => changeMinutes(Number(e.target.value))} className="w-20 rounded-lg bg-white px-2 py-1.5 text-right font-semibold tabular-nums ring-1 ring-slate-200" /></div>
        <input aria-label="Длительность простоя в минутах" type="range" min={0} max={60} step={1} value={minutes} onChange={e => changeMinutes(Number(e.target.value))} className="mt-3 w-full accent-sky-500" />
        <div className="mt-1 flex justify-between text-[11px] text-slate-400"><span>0 мин</span><span>60 мин</span></div>
      </div>
      <div aria-live="polite" aria-atomic="true" className="grid grid-cols-2 gap-3">
        <div><div className="text-xs text-slate-500">{saving ? 'Сохраним выпуск' : 'Потеряем выпуск'}</div><div className="mt-1 text-xl font-semibold tabular-nums">≈ {n1(cars)} <span className="text-sm font-normal text-slate-500">маш.</span></div></div>
        <div><div className="text-xs text-slate-500">{saving ? 'Сохраним маржу' : 'Недополучим маржу'}</div><div className={`mt-1 text-xl font-semibold tabular-nums ${saving ? 'text-emerald-700' : 'text-amber-700'}`}>≈ {tenge(amount)}</div></div>
      </div>
    </div>
    <p className="mt-3 text-xs text-slate-500">При нескольких поломках дороже всего ждать участок «{rows[0].name}». {row.limits_output && 'Этот участок также ограничивает выпуск линии.'}</p>
    <div className="mt-3"><MoneyInputs compact /></div>
    <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">Как считаем · приблизительная оценка</summary>
      <p className="mt-2">Минуты × средняя потеря за минуту из часового прогона двойника × маржа с машины. Оценка линейная: короткий простой могут прикрыть буферы. Ремонт и спрос здесь не учтены. Расчёт — для базовой линии с актуальной калибровкой, без выбранных выше разовых сбоев.</p>
      <div className="mt-2 space-y-1">{rows.map(r => <div key={r.station} className="flex justify-between gap-3"><span>{r.name}</span><span>{tenge(r.loss_per_min * money.margin)}/мин · −{n1(r.loss_per_hour)} маш./час</span></div>)}</div>
      <p className="mt-2">Маржа с машины: {tenge(money.margin)}. Час простоя проверен на {d.reps} парных прогонах; диапазон потерь выбранного участка за час: {n1(row.loss_ci[0])}–{n1(row.loss_ci[1])} машин (95%).</p>
    </details>
  </Card>
}
