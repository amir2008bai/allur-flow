import ReactECharts from 'echarts-for-react'
import { TrendingDown } from 'lucide-react'
import { useMemo } from 'react'
import type { SimRun } from '../source'
import { tenge, useMoney } from '../money'
import { Card, SourceBadge } from '../ui'
import { t } from '../i18n'

const RU: Record<string, string> = { welding: 'сварка', paint: 'окраска', assembly: 'сборка', qc: 'ОТК' }
const n0 = (x: number) => Math.round(x).toLocaleString('ru-RU')
const n1 = (x: number) => x.toFixed(1).replace('.', ',')

interface Step { name: string; value: number; kind: 'start' | 'avail' | 'perf' | 'quality' | 'end'; hint: string }
const COLOR = { start: '#94a3b8', avail: '#ef4444', perf: '#f59e0b', quality: '#a855f7', end: '#0f172a' }

/** Каскад потерь: идеальный выпуск → минус поломки (по участкам) → минус темп и ожидания → минус брак (по участкам) → факт. */
export default function LossCascade({ run }: { run: SimRun }) {
  const money = useMoney()
  const op = run.kpi.oee_parts
  const steps = useMemo<Step[] | null>(() => {
    if (!op) return null
    const c = op.cars
    const by = op.cars_by
    const s: Step[] = [{ name: 'Идеальная линия', value: c.ideal, kind: 'start', hint: 'без поломок, ожиданий и брака при идеальном цикле 3,4 мин (допущение A7)' }]
    const avail = by ? Object.entries(by.availability) : [['all', c.availability] as [string, number]]
    let small = 0   // ступени меньше полмашины — одной строкой, чтобы каскад сходился к факту
    avail.sort((a, b) => b[1] - a[1]).forEach(([st, v]) => { if (v < 0.5) small += v; else s.push({ name: `Поломки: ${RU[st] ?? 'линия'}`, value: v, kind: 'avail', hint: 'линия не выпускала машины, пока участок стоял' }) })
    if (c.performance < 0.5) small += c.performance; else s.push({ name: 'Темп и ожидания', value: c.performance, kind: 'perf', hint: 'участки ждали кузов или работали медленнее идеального цикла' })
    const qual = by ? Object.entries(by.quality) : [['all', c.quality] as [string, number]]
    qual.sort((a, b) => b[1] - a[1]).forEach(([st, v]) => { if (v < 0.5) small += v; else s.push({ name: `Брак: ${RU[st] ?? 'линия'}`, value: v, kind: 'quality', hint: 'время на переделку кузовов с дефектом' }) })
    if (small >= 0.05) s.push({ name: 'Мелкие потери', value: small, kind: 'perf', hint: 'несколько причин меньше полмашины каждая' })
    s.push({ name: 'Факт', value: c.good, kind: 'end', hint: 'годные на выходе ОТК' })
    return s
  }, [op])

  const option = useMemo(() => {
    if (!steps) return null
    let level = steps[0].value
    const base: number[] = [], val: number[] = []
    for (const st of steps) {
      if (st.kind === 'start' || st.kind === 'end') { base.push(0); val.push(st.value) }
      else { level -= st.value; base.push(level); val.push(st.value) }
    }
    const plan = run.kpi.plan_per_shift * (run.horizon / 480)
    // шкала начинается не с нуля: иначе потери в 5–15 машин на фоне 280 не видны (подписано под графиком)
    const xMin = Math.max(0, Math.floor((Math.min(steps[steps.length - 1].value, plan) - 25) / 10) * 10)
    return {
      animation: false,
      grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
      tooltip: { trigger: 'axis', confine: true, axisPointer: { type: 'shadow' },
        formatter: (ps: { dataIndex: number }[]) => { const st = steps[ps[0].dataIndex]; return `<b>${st.name}</b>: ${st.kind === 'start' || st.kind === 'end' ? '' : '−'}${n1(st.value)} машин<br/><span style="color:#64748b">${st.hint}</span>` } },
      xAxis: { type: 'value', min: xMin, axisLabel: { color: '#94a3b8', fontSize: 10 }, splitLine: { lineStyle: { color: '#eef1f5' } } },
      yAxis: { type: 'category', inverse: true, data: steps.map((s) => s.name), axisLabel: { color: '#334155', fontSize: 11 }, axisTick: { show: false } },
      series: [
        { type: 'bar', stack: 'w', silent: true, itemStyle: { color: 'transparent' }, data: base },
        { type: 'bar', stack: 'w', barWidth: 16, data: val.map((v, i) => ({ value: v, itemStyle: { color: COLOR[steps[i].kind], borderRadius: 4 } })),
          label: { show: true, position: 'right', color: '#334155', fontSize: 11, formatter: (p: { dataIndex: number; value: number }) => `${steps[p.dataIndex].kind === 'start' || steps[p.dataIndex].kind === 'end' ? '' : '−'}${n1(p.value)}` },
          markLine: { symbol: 'none', silent: true, lineStyle: { color: '#16a34a', type: 'dashed' }, label: { formatter: `план ${n0(plan)}`, color: '#16a34a', fontSize: 10, position: 'insideEndTop' }, data: [{ xAxis: plan }] } },
      ],
    }
  }, [steps, run])

  if (!op || !steps || !option) return null
  const losses = steps.filter((s) => s.kind !== 'start' && s.kind !== 'end')
  const top = losses.reduce((a, b) => (b.value > a.value ? b : a), losses[0])
  const shifts = run.horizon / 480

  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-700"><TrendingDown size={18} /></span>
          <div>
            <h2 className="text-lg font-semibold leading-tight">{t('Куда уходят машины')}</h2>
            <p className="text-sm text-slate-500">Каскад потерь за {shifts === 2 ? '2 смены' : 'смену'}: от идеальной линии до факта. OEE {Math.round(run.kpi.oee_pct)}% = доступность {Math.round(op.availability)}% × темп {Math.round(op.performance)}% × качество {Math.round(op.quality)}%.</p>
          </div>
        </div>
        <SourceBadge source="sim" />
      </div>
      {top && (
        <div className="mb-2 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700 ring-1 ring-slate-100">
          Больше всего машин съедает <b>{top.name.toLowerCase()}</b>: −{n1(top.value)} ({tenge(top.value * money.margin)} заработка).
          {top.kind === 'quality' && ' Переделка занимает участок — меньше брака значит больше машин.'}
          {top.kind === 'avail' && ' Быстрее ремонт этого участка — больше машин.'}
          {top.kind === 'perf' && ' Участки ждут друг друга — помогают накопители и разгрузка узкого места.'}
        </div>
      )}
      <div style={{ height: 40 + steps.length * 30 }}><ReactECharts option={option} style={{ height: '100%' }} notMerge /></div>
      <p className="mt-2 text-[11px] text-slate-400">
        <span className="font-medium" style={{ color: COLOR.avail }}>■</span> поломки · <span className="font-medium" style={{ color: COLOR.perf }}>■</span> темп и ожидания ·{' '}
        <span className="font-medium" style={{ color: COLOR.quality }}>■</span> брак и переделка. Потеря отнесена к причине, которая была в ту же минуту (поломка, прошедшая через накопитель позже, попадёт в «темп»).
        {op.planned_min > 0 && ` Плановые остановки (${n0(op.planned_min)} мин) в каскад не входят.`} Ступени в сумме дают ровно факт. Шкала начинается не с нуля, чтобы были видны потери.
      </p>
    </Card>
  )
}
