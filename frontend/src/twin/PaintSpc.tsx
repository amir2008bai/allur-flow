import ReactECharts from 'echarts-for-react'
import { Activity, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { todayISO } from '../dates'
import { Card, SourceBadge } from '../ui'
import { useView } from './store'
import { journalRequest } from './journalRequest'

interface Point { day: string; n: number; defects: number; p: number; ucl: number; lcl: number; source: 'fact' | 'sim'; signals: string[]; conditions?: string }
type Area = 'welding' | 'paint' | 'assembly'
const AREAS: { id: Area; name: string }[] = [{ id: 'welding', name: 'Сварка' }, { id: 'paint', name: 'Окраска' }, { id: 'assembly', name: 'Сборка' }]
interface Spc { area: Area; checks: string; pbar: number; norm: number; points: Point[]; facts: number; verdict: { kind: 'special' | 'chronic' | 'ok'; title: string; text: string; day?: string } }

const pc = (x: number) => `${(100 * x).toFixed(1).replace('.', ',')}%`
const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`

/** Контрольная карта брака окраски (p-карта Шухарта): обычный разброс процесса или особая причина. */
export default function PaintSpc() {
  const [d, setD] = useState<Spc | null>(null)
  const [area, setArea] = useState<Area>('paint')
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const setDate = useView((v) => v.setDate)
  const today = todayISO()
  useEffect(() => {
    const controller = new AbortController()
    setD(null); setError(null)
    journalRequest<Spc>(`/api/spc/quality?today=${today}&area=${area}`, { signal: controller.signal })
      .then(data => {
        if (data.area !== area || !Array.isArray(data.points) || !data.verdict) throw new Error('Сервер вернул неполную карту брака.')
        if (!controller.signal.aborted) setD(data)
      })
      .catch((e: Error) => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [today, area, tick])

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

  const current = d?.area === area ? d : null
  const v = current?.verdict
  const tone = v?.kind === 'special' ? 'bg-red-50 text-red-800' : v?.kind === 'chronic' ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-800'
  const Icon = v?.kind === 'ok' ? CheckCircle2 : AlertTriangle
  return <Card className="p-4 sm:p-5">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><Activity size={18} />Контроль брака</h2>
      <div className="flex gap-1.5"><SourceBadge source="calc" />{current && current.facts > 0 && <SourceBadge source="fact" />}{current && current.points.some(p => p.source === 'sim') && <SourceBadge source="sim" />}</div>
    </div>
    <div className="mb-3 flex gap-2" role="tablist" aria-label="Участок контроля брака">
      {AREAS.map(a => <button key={a.id} role="tab" id={`quality-tab-${a.id}`} aria-selected={area === a.id} aria-controls="quality-panel" onClick={() => setArea(a.id)} className={`rounded-xl px-3 py-2 text-sm font-medium ${area === a.id ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}>{a.name}</button>)}
    </div>
    <div role="tabpanel" id="quality-panel" aria-labelledby={`quality-tab-${area}`}>
      {error ? <div role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{error}<button onClick={() => setTick(x => x + 1)} className="ml-3 rounded-lg bg-white px-3 py-2 font-medium">Повторить</button></div>
        : !current || !v || !option ? <div role="status" className="py-5 text-sm text-slate-500">Строю график брака…</div>
        : !current.points.length ? <p className="text-sm text-slate-500">Пока нет дней с выпуском на этом участке.</p>
        : <>
          <div className={`flex items-start gap-2 rounded-xl px-3 py-2 ${tone}`}><Icon size={16} className="mt-0.5 shrink-0" /><div className="text-sm"><b>{v.title}</b><details className="mt-1"><summary className="cursor-pointer text-xs">Что это значит</summary><p className="mt-1">{v.text}</p></details></div></div>
          <div className="mt-3 h-56"><ReactECharts option={option} style={{ height: '100%' }} notMerge onEvents={{ click: (e: { dataIndex: number }) => { const p = current.points[e.dataIndex]; if (p) setDate(p.day) } }} /></div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500"><span>■ данные завода · ● двойник</span><span>Красная точка — необычный брак</span><span>Средний {pc(current.pbar)} · норма {pc(current.norm)}</span></div>
          <p className="mt-2 text-xs text-slate-500"><b>Что проверить:</b> {current.checks}. Это возможные факторы, а не доказанные причины.</p>
          <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">Таблица по дням · {current.points.length} записей</summary>
            <div className="mt-2 max-h-64 overflow-auto"><table className="w-full text-left text-xs"><thead><tr className="text-slate-400"><th className="py-2 font-normal">День</th><th className="py-2 font-normal">Брак / выпуск</th><th className="py-2 font-normal">Брак, %</th><th className="py-2 font-normal">Источник</th></tr></thead><tbody className="divide-y divide-slate-100">{current.points.map(p => <tr key={p.day}><td className="py-2"><button onClick={() => setDate(p.day)} className="font-medium text-slate-700 underline decoration-slate-200 underline-offset-4">{dm(p.day)}</button></td><td>{p.defects} / {p.n}</td><td className={p.signals.length ? 'font-semibold text-red-600' : ''}>{pc(p.p)}</td><td>{p.source === 'fact' ? 'Факт' : 'Двойник'}</td></tr>)}</tbody></table></div>
          </details>
          {current.points.some(p => p.signals.length) && <details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">Дни, которые требуют разбора</summary><ul className="mt-2 space-y-2">{current.points.filter(p => p.signals.length).map(p => <li key={p.day}><b>{dm(p.day)}</b>: {p.signals.join('; ')}{p.conditions && ` · ${p.conditions}`}</li>)}</ul></details>}
          <details className="mt-2 text-[11px] text-slate-400"><summary className="flex cursor-pointer items-center gap-1"><Info size={12} />Как читать график</summary><p className="mt-1">Пунктир — границы обычного разброса (3σ), зелёная линия — норма. Сигнал: точка вне границ, 9 точек по одну сторону среднего или 6 точек с ростом/падением. Факты и модельные дни показаны вместе: эта карта демонстрирует работу контроля, вывод о заводе требует реальных данных. Клик по точке открывает день.</p></details>
        </>}
    </div>
  </Card>
}
