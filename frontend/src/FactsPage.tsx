import { useMemo, useState } from 'react'
import type { AreaId, Facts, Finding, Severity } from './types'
import { Card, SEVERITY, SourceBadge, fmt } from './ui'

const SEV_RANK: Record<Severity, number> = { critical: 0, warn: 1, info: 2, ok: 3 }

function areaSeverity(findings: Finding[], area: AreaId): Severity | null {
  const list = findings.filter((f) => f.area === area)
  if (!list.length) return null
  return list.reduce((a, f) => (SEV_RANK[f.severity] < SEV_RANK[a] ? f.severity : a), 'ok' as Severity)
}

function Kpi({ label, value, unit, sub, tone }: { label: string; value: string; unit?: string; sub: string; tone?: Severity }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
        {tone && tone !== 'info' && <span className={`h-2 w-2 rounded-full ${SEVERITY[tone].dot}`} />}
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-3xl font-semibold tracking-tight">{value}</span>
        {unit && <span className="text-sm text-slate-500">{unit}</span>}
      </div>
      <div className="mt-1 text-xs text-slate-500">{sub}</div>
    </Card>
  )
}

function Route({ facts, findings, selected, onSelect }: { facts: Facts; findings: Finding[]; selected: AreaId | null; onSelect: (a: AreaId | null) => void }) {
  return (
    <Card className="p-5">
      <div className="mb-4 text-xs font-medium text-slate-500">Маршрут кузова · из ТЗ</div>
      <div className="flex flex-wrap items-center gap-2">
        {facts.route.map((a, i) => {
          const sev = areaSeverity(findings, a.id)
          const active = selected === a.id
          return (
            <div key={a.id} className="flex items-center gap-2">
              <button
                onClick={() => onSelect(active ? null : a.id)}
                className={`flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm transition ring-1 ${
                  active ? 'bg-slate-900 text-white ring-slate-900' : 'bg-slate-50 text-slate-700 ring-slate-200 hover:bg-white'
                }`}
              >
                {sev && sev !== 'ok' && sev !== 'info' && <span className={`h-2 w-2 rounded-full ${SEVERITY[sev].dot} ${sev === 'critical' ? 'animate-pulse' : ''}`} />}
                {a.name}
              </button>
              {i < facts.route.length - 1 && <span className="text-slate-300">→</span>}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function FindingCard({ f }: { f: Finding }) {
  const [open, setOpen] = useState(false)
  const s = SEVERITY[f.severity]
  return (
    <Card className={`p-5 ${f.severity === 'critical' ? 'ring-red-200' : f.severity === 'warn' ? 'ring-amber-200' : ''}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${s.dot}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="font-semibold">{f.title}</h3>
            <span className="text-xs text-slate-400">{s.label}</span>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{f.summary}</p>
          {f.metrics.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {f.metrics.map((m) => (
                <div key={m.label} className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                  <div className="text-[11px] text-slate-500">{m.label}</div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="text-sm font-semibold">{fmt(m.value)}{m.unit && <span className="ml-0.5 font-normal text-slate-500">{m.unit}</span>}</span>
                    <SourceBadge source={m.source} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {(f.caveat || f.provenance.length > 0) && (
            <button onClick={() => setOpen(!open)} className="mt-3 text-xs font-medium text-slate-500 hover:text-slate-800">
              {open ? 'Скрыть' : 'Оговорки и источник'}
            </button>
          )}
          {open && (
            <div className="mt-2 space-y-1 text-xs text-slate-500">
              {f.caveat && <p>⚠ {f.caveat}</p>}
              {f.provenance.length > 0 && (
                <p>Источник: {f.provenance[0].file}, {[...new Set(f.provenance.map((p) => `табл. ${p.table} стр. ${p.row}`))].join('; ')}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

function RawTables({ facts }: { facts: Facts }) {
  const area = Object.fromEntries(facts.route.map((a) => [a.id, a.name]))
  const th = 'px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-slate-500'
  const td = 'px-3 py-2 text-sm tabular-nums'
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="overflow-x-auto p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">Работа линий <SourceBadge source="fact" /></div>
        <table className="w-full"><thead><tr>{['Дата', 'Линия', 'План', 'Факт', 'Часы', 'Загрузка'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>{facts.lines.map((l) => <tr key={l.date + l.line} className="border-t border-slate-100"><td className={td}>{l.date.slice(8, 10)}.{l.date.slice(5, 7)}</td><td className={td}>{l.line}</td><td className={td}>{l.plan}</td><td className={td}>{l.fact}</td><td className={td}>{l.runtime_h}</td><td className={td}>{l.utilization_pct}%</td></tr>)}</tbody></table>
      </Card>
      <Card className="overflow-x-auto p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">Качество <SourceBadge source="fact" /></div>
        <table className="w-full"><thead><tr>{['Дата', 'Участок', 'Выпущено', 'Брак', '% брака'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>{facts.quality.map((q) => <tr key={q.date + q.area} className="border-t border-slate-100"><td className={td}>{q.date.slice(8, 10)}.{q.date.slice(5, 7)}</td><td className={td}>{area[q.area]}</td><td className={td}>{q.produced}</td><td className={td}>{q.defects}</td><td className={`${td} ${q.defect_pct_reported > facts.targets.defect_max_pct ? 'font-semibold text-red-600' : ''}`}>{fmt(q.defect_pct_reported)}%</td></tr>)}</tbody></table>
      </Card>
      <Card className="overflow-x-auto p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">Простои оборудования <SourceBadge source="fact" /></div>
        <table className="w-full"><thead><tr>{['Дата', 'Участок', 'Оборудование', 'Причина', 'Мин'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>{facts.downtime.map((d) => <tr key={d.date + d.equipment} className="border-t border-slate-100"><td className={td}>{d.date.slice(8, 10)}.{d.date.slice(5, 7)}</td><td className={td}>{area[d.area]}</td><td className={td}>{d.equipment}</td><td className={td}>{d.reason}</td><td className={td}>{d.minutes}</td></tr>)}</tbody></table>
      </Card>
      <Card className="overflow-x-auto p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">План на месяц <SourceBadge source="fact" /></div>
        <table className="w-full"><thead><tr>{['Модель', 'План'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>{facts.model_plan.map((m) => <tr key={m.model} className="border-t border-slate-100"><td className={td}>{m.model}</td><td className={td}>{m.monthly_plan}</td></tr>)}
            <tr className="border-t border-slate-200"><td className={`${td} font-semibold`}>Итого / цель</td><td className={`${td} font-semibold`}>{facts.model_plan.reduce((s, m) => s + m.monthly_plan, 0)} / {facts.targets.monthly_output_min}</td></tr></tbody></table>
      </Card>
    </div>
  )
}

export default function FactsPage({ facts, findings }: { facts: Facts; findings: Finding[] }) {
  const [area, setArea] = useState<AreaId | null>(null)
  const t = facts.targets
  const kpi = useMemo(() => {
    const paint = facts.quality.filter((q) => q.area === 'paint')
    const paintPct = (100 * paint.reduce((s, q) => s + q.defects, 0)) / paint.reduce((s, q) => s + q.produced, 0)
    const plan = facts.model_plan.reduce((s, m) => s + m.monthly_plan, 0)
    const worst = facts.downtime.filter((d) => !d.planned).reduce((a, d) => (d.minutes > a.minutes ? d : a))
    return { paintPct, plan, worst }
  }, [facts])
  const shown = area ? findings.filter((f) => f.area === area) : findings

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Брак окраски, 2 дня" value={fmt(Math.round(kpi.paintPct * 100) / 100)} unit="%" sub={`норма ≤ ${t.defect_max_pct}% · расчёт по факту`} tone="critical" />
        <Kpi label="План по моделям" value={fmt(kpi.plan)} unit={`/ ${fmt(t.monthly_output_min)}`} sub={`разрыв ${fmt(t.monthly_output_min - kpi.plan)} авто — план не согласован`} tone="warn" />
        <Kpi label="Максимальный внеплановый простой" value={String(kpi.worst.minutes)} unit={`/ ${t.critical_downtime_max_min_per_day} мин`} sub={`${kpi.worst.equipment} · ${kpi.worst.reason.toLowerCase()}`} tone="warn" />
        <Kpi label={`OEE (цель ≥ ${t.oee_min_pct}%)`} value="н/д" sub="нет идеального времени цикла" tone="info" />
      </div>

      <Route facts={facts} findings={findings} selected={area} onSelect={setArea} />

      <div>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Что видно в данных {area && <span className="text-slate-400">· {facts.route.find((a) => a.id === area)?.name}</span>}</h2>
          <span className="text-xs text-slate-500">{shown.length} выводов</span>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {shown.map((f) => <FindingCard key={f.id} f={f} />)}
          {shown.length === 0 && <Card className="p-5 text-sm text-slate-500">По этому участку в данных ТЗ нет записей.</Card>}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Исходные таблицы из ТЗ</h2>
        <RawTables facts={facts} />
      </div>
    </div>
  )
}
