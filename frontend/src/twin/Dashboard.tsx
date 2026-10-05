import ReactECharts from 'echarts-for-react'
import { useMemo } from 'react'
import type { SimRun } from '../source'
import { Card } from '../ui'
import { ZONE_BY_STATION } from './layout'
import { useView } from './store'
import { clock } from './Timeline'

// Панель руководителя: выпуск против плана по ходу смены + журнал остановок.
export default function Dashboard({ run }: { run: SimRun }) {
  const t = useView((s) => s.t)
  const setT = useView((s) => s.setT)
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
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="p-5 lg:col-span-2">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">Выпуск против плана</h2>
          <span className={`text-sm font-semibold tabular-nums ${gap < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
            {clock(t)}: {gap >= 0 ? '+' : ''}{gap} к плану
          </span>
        </div>
        <ReactECharts option={option} style={{ height: 220 }} notMerge onEvents={{ click: (p: { value?: [number, number] }) => p.value && setT(p.value[0]) }} />
      </Card>
      <Card className="p-5">
        <h2 className="font-semibold">Журнал остановок</h2>
        <ul className="mt-3 space-y-2">
          {run.stops.length === 0 && <li className="text-sm text-slate-400">остановок не было</li>}
          {run.stops.map((s, i) => (
            <li key={i}>
              <button onClick={() => { setT(s.t); useView.getState().select(ZONE_BY_STATION[s.station]?.id ?? null) }}
                className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50 ${s.t <= t ? '' : 'opacity-40'}`}>
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${s.planned ? 'bg-sky-400' : 'bg-red-500'}`} />
                <span className="flex-1 text-sm">
                  <span className="font-medium">{clock(s.t)} · {ZONE_BY_STATION[s.station]?.name}</span>
                  <span className="block text-xs text-slate-500">{s.reason}</span>
                </span>
                <span className="shrink-0 text-sm tabular-nums">{Math.round(s.minutes)} мин</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
