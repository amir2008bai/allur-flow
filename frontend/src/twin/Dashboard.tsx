import ReactECharts from 'echarts-for-react'
import { BellRing, OctagonAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { SimRun } from '../source'
import { Card } from '../ui'
import { ZONE_BY_STATION } from './layout'
import { useView } from './store'
import { clock } from './Timeline'
import { stamp } from '../dates'
import { t as tr } from '../i18n'

// Панель руководителя: выпуск против плана по ходу смены + журнал остановок.
export default function Dashboard({ run }: { run: SimRun }) {
  const t = useView((s) => s.t)
  const setT = useView((s) => s.setT)
  const date = useView((s) => s.date)
  const [filter, setFilter] = useState<'all' | 'stops' | 'alerts'>('all')
  const events = useMemo(() => {
    const stops = run.stops.map((s) => ({ kind: 'stop' as const, t: s.t, title: `${ZONE_BY_STATION[s.station]?.name}: ${s.planned ? 'плановая остановка' : 'остановка'}`, text: s.reason, minutes: s.minutes, zone: ZONE_BY_STATION[s.station]?.id }))
    const alerts = (run.alerts ?? []).map((a) => ({ kind: 'alert' as const, t: a.t, title: a.title, text: a.text, minutes: null as number | null, zone: undefined }))
    return [...(filter !== 'alerts' ? stops : []), ...(filter !== 'stops' ? alerts : [])].sort((a, b) => a.t - b.t)
  }, [run, filter])
  const option = useMemo(() => {
    const xs = run.frames.filter((_, i) => i % 5 === 0)
    const planPerMin = 120 / 480
    return {
      animation: false,
      grid: { left: 40, right: 16, top: 28, bottom: 28 },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${Math.round(v)}` },
      legend: { top: 0, right: 0, itemWidth: 14, itemHeight: 3, textStyle: { color: '#64748b', fontSize: 11 } },
      xAxis: { type: 'value', min: 0, max: run.horizon, interval: 120, axisLabel: { formatter: (v: number) => clock(v), color: '#94a3b8', fontSize: 10 }, splitLine: { show: false } },
      yAxis: { type: 'value', axisLabel: { color: '#94a3b8', fontSize: 10 }, splitLine: { lineStyle: { color: '#eef1f5' } } },
      series: [
        { name: 'План', type: 'line', showSymbol: false, lineStyle: { color: '#cbd5e1', type: 'dashed', width: 1.5 }, data: [[0, 0], [run.horizon, planPerMin * run.horizon]] },
        { name: 'Годные (симуляция)', type: 'line', showSymbol: false, lineStyle: { color: '#0f172a', width: 2 }, areaStyle: { color: 'rgba(15,23,42,0.05)' }, data: xs.map((f) => [f.t, f.good]),
          markLine: { symbol: 'none', silent: true, label: { show: false }, lineStyle: { color: '#f59e0b', width: 1.5 }, data: [{ xAxis: t }] } },
      ],
    }
  }, [run, t])

  const lastFrame = run.frames[Math.min(Math.floor(t), run.frames.length - 1)]
  const planNow = Math.round((120 / 480) * t)
  const gap = (lastFrame?.good ?? 0) - planNow

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-3">
      <Card className="min-w-0 p-5 lg:col-span-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 className="font-semibold">Выпуск против плана</h2>
          <span className={`text-sm font-semibold tabular-nums ${gap < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
            {clock(t)}: {gap >= 0 ? '+' : ''}{gap} к плану
          </span>
        </div>
        <ReactECharts option={option} style={{ height: 220 }} notMerge onEvents={{ click: (p: { value?: [number, number] }) => p.value && setT(p.value[0]) }} />
      </Card>
      <Card className="flex max-h-[340px] min-w-0 flex-col p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">{tr('Журнал событий')}</h2>
          <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs">
            {(['all', 'stops', 'alerts'] as const).map((k) => (
              <button key={k} onClick={() => setFilter(k)} className={`rounded-md px-2 py-1 ${filter === k ? 'bg-white font-medium shadow-sm' : 'text-slate-500'}`}>{k === 'all' ? 'Все' : k === 'stops' ? 'Остановки' : 'Тревоги'}</button>
            ))}
          </div>
        </div>
        <ul className="mt-3 flex-1 space-y-1 overflow-y-auto pr-1">
          {events.length === 0 && <li className="text-sm text-slate-400">событий нет</li>}
          {events.map((e, i) => (
            <li key={i}>
              <button onClick={() => { setT(e.t); if (e.zone) useView.getState().select(e.zone) }}
                className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50 ${e.t <= t ? '' : 'opacity-40'}`}>
                {e.kind === 'stop' ? <OctagonAlert size={15} className="mt-0.5 shrink-0 text-red-500" /> : <BellRing size={15} className="mt-0.5 shrink-0 text-amber-500" />}
                <span className="min-w-0 flex-1 text-sm">
                  <span className="font-medium">{e.title}</span>
                  <span className="block truncate text-xs text-slate-500">{stamp(date, e.t)} · {e.text}</span>
                </span>
                {e.minutes != null && <span className="shrink-0 text-sm tabular-nums">{Math.round(e.minutes)} мин</span>}
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
