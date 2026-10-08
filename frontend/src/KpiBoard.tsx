import { Gauge } from 'lucide-react'
import type { SimRun } from './source'
import type { Facts } from './types'
import { Card, SourceBadge } from './ui'

type Src = 'fact' | 'calc' | 'sim' | 'assumption'
type Tone = 'ok' | 'warn' | 'bad' | 'none'
interface Bar { name: string; value: number; tone: Tone; text: string }
interface Tile { key: string; title: string; value: string; sub: string; tone: Tone; source: Src; bars?: Bar[] }

const RU: Record<string, string> = { welding: 'Сварка', paint: 'Окраска', assembly: 'Сборка', qc: 'ОТК' }
const n1 = (x: number) => (Math.round(x * 10) / 10).toString().replace('.', ',')
const TONE: Record<Tone, string> = { ok: 'text-emerald-700', warn: 'text-amber-700', bad: 'text-red-600', none: 'text-slate-500' }
const BAR: Record<Tone, string> = { ok: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-500', none: 'bg-slate-300' }

/** Четыре показателя ТЗ (производительность, загрузка, простои, качество) + OEE — по данным завода. */
export function factTiles(f: Facts): Tile[] {
  const t = f.targets
  const exit = f.lines.filter((l) => l.area === 'assembly')
  const exitPct = exit.length ? (100 * exit.reduce((s, l) => s + l.fact, 0)) / exit.reduce((s, l) => s + l.plan, 0) : 0
  const lines = [...new Set(f.lines.map((l) => l.line))]
  const util = lines.map((name) => {
    const rows = f.lines.filter((l) => l.line === name)
    const v = rows.reduce((s, l) => s + l.utilization_pct, 0) / rows.length
    return { name, value: v, tone: (v >= 95 ? 'ok' : v >= 90 ? 'warn' : 'bad') as Tone, text: `${n1(v)}%` }
  })
  // лимит простоя — на единицу оборудования за сутки; плановое ТО отдельно
  const perEq = new Map<string, number>()
  f.downtime.filter((d) => !d.planned).forEach((d) => { const k = `${d.equipment}·${d.date}`; perEq.set(k, (perEq.get(k) ?? 0) + d.minutes) })
  const worst = [...perEq.entries()].sort((a, b) => b[1] - a[1])[0]
  const areas = ['welding', 'paint', 'assembly'] as const
  const defect = areas.map((a) => {
    const q = f.quality.filter((x) => x.area === a)
    const n = q.reduce((s, x) => s + x.produced, 0), d = q.reduce((s, x) => s + x.defects, 0)
    const v = n ? (100 * d) / n : 0
    return { name: RU[a], value: v, tone: (v > t.defect_max_pct ? 'bad' : v > 0.8 * t.defect_max_pct ? 'warn' : 'ok') as Tone, text: `${n1(v)}%` }
  })
  const over = defect.filter((x) => x.tone === 'bad').length
  return [
    { key: 'perf', title: 'Производительность', value: `${Math.round(exitPct)}%`, sub: `выпуск сборки к плану · ${exit.map((l) => `${l.fact}/${l.plan}`).join(', ')}`, tone: exitPct >= 100 ? 'ok' : exitPct >= 95 ? 'warn' : 'bad', source: 'fact' },
    { key: 'util', title: 'Загрузка', value: `${n1(util.reduce((s, x) => s + x.value, 0) / Math.max(1, util.length))}%`, sub: 'время работы ÷ 8 ч, среднее по линиям', tone: 'none', source: 'fact', bars: util },
    { key: 'down', title: 'Простои', value: worst ? `${worst[1]} мин` : '0 мин', sub: worst ? `худший: ${worst[0].split('·')[0]} · лимит ${t.critical_downtime_max_min_per_day} мин/сутки на единицу` : 'внеплановых нет', tone: !worst ? 'ok' : worst[1] > t.critical_downtime_max_min_per_day ? 'bad' : worst[1] > 0.75 * t.critical_downtime_max_min_per_day ? 'warn' : 'ok', source: 'fact' },
    { key: 'quality', title: 'Качество (брак)', value: over ? `выше нормы: ${over}` : 'в норме', sub: `норма ≤ ${t.defect_max_pct}% · за период по участкам`, tone: over ? 'bad' : 'ok', source: 'calc', bars: defect },
    { key: 'oee', title: 'OEE', value: 'н/д', sub: `цель ≥ ${t.oee_min_pct}% · в данных нет идеального цикла — считаем в двойнике`, tone: 'none', source: 'fact' },
  ]
}

/** Те же показатели по текущей симуляции двойника (2 смены). Загрузка — как в таблице Allur: доля времени без простоя. */
export function runTiles(run: SimRun, t: { oee_min_pct: number; defect_max_pct: number; downtime_max_min_per_day: number }): Tile[] {
  const k = run.kpi
  const st = ['welding', 'paint', 'assembly', 'qc'].filter((s) => k.state_shares[s])
  const util = st.map((s) => { const v = 100 * (1 - k.state_shares[s].down); return { name: RU[s], value: v, tone: (v >= 95 ? 'ok' : v >= 90 ? 'warn' : 'bad') as Tone, text: `${n1(v)}%` } })
  const busy = st.map((s) => 100 * k.state_shares[s].working)
  const down = Object.entries(k.unplanned_downtime_min_per_day).filter(([s]) => s !== 'qc').sort((a, b) => b[1] - a[1])[0]
  const defect = ['welding', 'paint', 'assembly'].map((s) => { const v = k.defect_pct[s] ?? 0; return { name: RU[s], value: v, tone: (v > t.defect_max_pct ? 'bad' : v > 0.8 * t.defect_max_pct ? 'warn' : 'ok') as Tone, text: `${n1(v)}%` } })
  const over = defect.filter((x) => x.tone === 'bad').length
  const perfPct = (100 * k.good_per_shift) / k.plan_per_shift
  const op = k.oee_parts
  return [
    { key: 'perf', title: 'Производительность', value: `${Math.round(k.good_per_shift)} / смену`, sub: `план ${k.plan_per_shift} · ${Math.round(perfPct)}% плана`, tone: perfPct >= 100 ? 'ok' : perfPct >= 95 ? 'warn' : 'bad', source: 'sim' },
    { key: 'util', title: 'Загрузка', value: `${n1(util.reduce((s, x) => s + x.value, 0) / Math.max(1, util.length))}%`, sub: `время без простоя ÷ смену · в работе с кузовом ${Math.round(Math.min(...busy))}–${Math.round(Math.max(...busy))}%`, tone: 'none', source: 'sim', bars: util },
    { key: 'down', title: 'Простои', value: down ? `${Math.round(down[1])} мин/сутки` : '0', sub: down ? `худший участок: ${RU[down[0]].toLowerCase()} · лимит ${t.downtime_max_min_per_day}` : '', tone: !down ? 'ok' : down[1] > t.downtime_max_min_per_day ? 'bad' : down[1] > 0.9 * t.downtime_max_min_per_day ? 'warn' : 'ok', source: 'sim' },
    { key: 'quality', title: 'Качество (брак)', value: over ? `выше нормы: ${over}` : 'в норме', sub: `норма ≤ ${t.defect_max_pct}% · по участкам`, tone: over ? 'bad' : 'ok', source: 'sim', bars: defect },
    { key: 'oee', title: 'OEE', value: `${Math.round(k.oee_pct)}%`, sub: op ? `цель ≥ ${t.oee_min_pct}% · доступность ${Math.round(op.availability)} × темп ${Math.round(op.performance)} × качество ${Math.round(op.quality)}` : `цель ≥ ${t.oee_min_pct}%`, tone: k.oee_pct < t.oee_min_pct ? 'bad' : k.oee_pct < t.oee_min_pct + 2 ? 'warn' : 'ok', source: 'assumption' },
  ]
}

/** Показатели ТЗ одной строкой карточек. */
export default function KpiBoard({ title, note, tiles }: { title: string; note?: string; tiles: Tile[] }) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Gauge size={16} className="text-slate-500" />{title}</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {tiles.map((x) => (
          <div key={x.key} className="rounded-2xl bg-slate-50 p-3.5 ring-1 ring-slate-100">
            <div className="flex items-center justify-between gap-1 text-xs text-slate-500">{x.title}<SourceBadge source={x.source} /></div>
            <div className={`mt-1 text-xl font-semibold tabular-nums ${x.tone === 'none' ? 'text-slate-900' : TONE[x.tone]}`}>{x.value}</div>
            {x.bars && (
              <div className="mt-1.5 space-y-1">
                {x.bars.map((b) => (
                  <div key={b.name} className="flex items-center gap-1.5 text-[11px] text-slate-600">
                    <span className="w-16 shrink-0 truncate">{b.name}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200"><span className={`block h-full rounded-full ${BAR[b.tone]}`} style={{ width: `${Math.min(100, x.key === 'quality' ? b.value * 10 : b.value)}%` }} /></span>
                    <span className="w-10 shrink-0 text-right tabular-nums">{b.text}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-1.5 text-[11px] leading-snug text-slate-500">{x.sub}</div>
          </div>
        ))}
      </div>
      {note && <p className="mt-2 text-[11px] text-slate-400">{note}</p>}
    </Card>
  )
}
