import ReactECharts from 'echarts-for-react'
import { Activity, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { todayISO } from '../dates'
import { Card, SourceBadge } from '../ui'
import { useView } from './store'

interface Point { day: string; n: number; defects: number; p: number; ucl: number; lcl: number; source: 'fact' | 'sim'; signals: string[]; conditions?: string }
interface Spc { pbar: number; norm: number; points: Point[]; facts: number; verdict: { kind: 'special' | 'chronic' | 'ok'; title: string; text: string; day?: string } }

const pc = (x: number) => `${(100 * x).toFixed(1).replace('.', ',')}%`
const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`

/** Контрольная карта брака окраски (p-карта Шухарта): обычный разброс процесса или особая причина. */
export default function PaintSpc() {
  const [d, setD] = useState<Spc | null>(null)
  const setDate = useView((v) => v.setDate)
  const today = todayISO()
  useEffect(() => { fetch(`/api/spc/paint?today=${today}`).then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => {}) }, [today])

  const option = useMemo(() => {
    if (!d) return null
    const x = d.points.map((p) => dm(p.day))
    const pct = (v: number) => +(100 * v).toFixed(2)
    return {
      animation: false,
      grid: { left: 36, right: 12, top: 52, bottom: 24 },
      legend: { top: 0, left: 0, itemWidth: 14, itemHeight: 3, textStyle: { color: '#64748b', fontSize: 11 }, data: ['Брак дня', 'Средний уровень', 'Граница обычного разброса', `Норма ТЗ ${pc(d.norm)}`] },
      tooltip: {
        trigger: 'axis',
        formatter: (ps: { dataIndex: number }[]) => {
          const p = d.points[ps[0].dataIndex]
          return `<b>${dm(p.day)}</b> · ${p.source === 'fact' ? 'данные завода' : 'двойник'}<br/>брак ${pc(p.p)} (${p.defects} из ${p.n})<br/>обычный разброс до ${pc(p.ucl)}`
            + (p.signals.length ? `<br/><span style="color:#dc2626">${p.signals.join('; ')}</span>` : '')
        },
      },
      xAxis: { type: 'category', data: x, axisLabel: { color: '#94a3b8', fontSize: 10 }, axisTick: { show: false } },
      yAxis: { type: 'value', min: 0, axisLabel: { color: '#94a3b8', fontSize: 10, formatter: (v: number) => `${v}%` }, splitLine: { lineStyle: { color: '#eef1f5' } } },
      series: [
        { name: 'Граница обычного разброса', type: 'line', step: 'middle', showSymbol: false, itemStyle: { color: '#94a3b8' }, lineStyle: { color: '#94a3b8', width: 1, type: 'dashed' }, data: d.points.map((p) => pct(p.ucl)) },
        { name: 'нижняя', type: 'line', step: 'middle', showSymbol: false, itemStyle: { color: '#94a3b8' }, lineStyle: { color: '#94a3b8', width: 1, type: 'dashed' }, data: d.points.map((p) => pct(p.lcl)), tooltip: { show: false } },
        { name: 'Средний уровень', type: 'line', showSymbol: false, itemStyle: { color: '#0f172a' }, lineStyle: { color: '#0f172a', width: 1.5 }, data: d.points.map(() => pct(d.pbar)) },
        { name: `Норма ТЗ ${pc(d.norm)}`, type: 'line', showSymbol: false, itemStyle: { color: '#16a34a' }, lineStyle: { color: '#16a34a', width: 1.5, type: 'dotted' }, data: d.points.map(() => pct(d.norm)) },
        {
          name: 'Брак дня', type: 'line', itemStyle: { color: '#0ea5e9' }, lineStyle: { color: '#0ea5e9', width: 1.5 }, symbolSize: 8,
          data: d.points.map((p) => ({
            value: pct(p.p),
            symbol: p.source === 'fact' ? 'rect' : 'circle',
            itemStyle: { color: p.signals.length ? '#dc2626' : p.source === 'fact' ? '#0f172a' : '#0ea5e9', borderColor: '#fff', borderWidth: 1 },
          })),
        },
      ],
    }
  }, [d])

  if (!d || !option) return <Card className="p-5 text-sm text-slate-500">Строю контрольную карту брака окраски…</Card>
  const v = d.verdict
  const tone = v.kind === 'special' ? 'bg-red-50 text-red-800 ring-red-200' : v.kind === 'chronic' ? 'bg-amber-50 text-amber-900 ring-amber-200' : 'bg-emerald-50 text-emerald-800 ring-emerald-200'
  const Icon = v.kind === 'ok' ? CheckCircle2 : AlertTriangle
  const special = d.points.filter((p) => p.signals.length)

  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-700"><Activity size={18} /></span>
          <div>
            <h2 className="text-lg font-semibold leading-tight">Контрольная карта брака окраски</h2>
            <p className="text-sm text-slate-500">Брак этого дня — обычный разброс или что-то сломалось? Последние {d.points.length} рабочих дней.</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5"><SourceBadge source="calc" />{d.facts > 0 && <SourceBadge source="fact" />}<SourceBadge source="sim" /></div>
      </div>

      <div className={`flex items-start gap-2 rounded-2xl px-4 py-3 ring-1 ${tone}`}>
        <Icon size={16} className="mt-0.5 shrink-0" />
        <div><div className="text-sm font-semibold">{v.title}</div><div className="mt-0.5 text-sm opacity-90">{v.text}</div></div>
      </div>

      <div className="mt-3 h-56"><ReactECharts option={option} style={{ height: '100%' }} notMerge
        onEvents={{ click: (e: { dataIndex: number }) => { const p = d.points[e.dataIndex]; if (p) setDate(p.day) } }} /></div>

      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="flex items-center gap-1"><span className="h-2 w-2 bg-slate-900" />данные завода</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-500" />двойник</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-600" />особая причина</span>
        <span>средний уровень {pc(d.pbar)} · норма {pc(d.norm)} · клик по точке — открыть день</span>
      </div>

      {special.length > 0 && (
        <ul className="mt-3 space-y-1">
          {special.map((p) => (
            <li key={p.day} className="text-xs text-slate-600"><b className="text-red-700">{dm(p.day)}</b> — брак {pc(p.p)}: {p.signals.join('; ')}{p.conditions && p.conditions !== 'штатная смена' ? ` · условия дня: ${p.conditions}` : ''}</li>
          ))}
        </ul>
      )}

      <p className="mt-3 flex items-start gap-1.5 text-[11px] text-slate-400">
        <Info size={12} className="mt-0.5 shrink-0" />
        Карта Шухарта — стандартный инструмент качества в автопроме. Границы — 3σ обычного разброса при объёме дня (меньше кузовов — шире границы).
        Сигналы: точка за границей, 9 дней подряд по одну сторону средней, 6 дней подряд рост или падение. Внутри границ процесс не «подкручивают» — это только увеличит брак.
      </p>
    </Card>
  )
}
