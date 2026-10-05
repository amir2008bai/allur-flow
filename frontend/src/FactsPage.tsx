import { useState } from 'react'
import type { AreaId, Facts, Finding, Severity } from './types'
import { Card, SEVERITY, SourceBadge, fmt } from './ui'

const SEV_RANK: Record<Severity, number> = { critical: 0, warn: 1, info: 2, ok: 3 }

function areaSeverity(findings: Finding[], area: AreaId): Severity | null {
  const list = findings.filter((f) => f.area === area)
  if (!list.length) return null
  return list.reduce((a, f) => (SEV_RANK[f.severity] < SEV_RANK[a] ? f.severity : a), 'ok' as Severity)
}

function Route({ facts, findings, selected, onSelect }: { facts: Facts; findings: Finding[]; selected: AreaId | null; onSelect: (a: AreaId | null) => void }) {
  return (
    <Card className="p-5">
      <div className="mb-4 text-xs font-medium text-slate-500">Маршрут кузова · нажмите на участок</div>
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

function Details({ f }: { f: Finding }) {
  return (
    <div className="mt-3 space-y-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
      <p className="text-slate-600">{f.summary}</p>
      {f.metrics.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {f.metrics.map((m) => (
            <div key={m.label} className="rounded-lg bg-slate-50 px-2.5 py-1.5 ring-1 ring-slate-100">
              <div className="text-[11px]">{m.label}</div>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-800">{fmt(m.value)}{m.unit && <span className="ml-0.5 font-normal text-slate-500">{m.unit}</span>}</span>
                <SourceBadge source={m.source} />
              </div>
            </div>
          ))}
        </div>
      )}
      {f.caveat && <p>⚠ {f.caveat}</p>}
      {f.provenance.length > 0 && (
        <p>Источник: Word-файл ТЗ, {[...new Set(f.provenance.map((p) => `табл. ${p.table} стр. ${p.row}`))].join('; ')}</p>
      )}
    </div>
  )
}

function ProblemCard({ f }: { f: Finding }) {
  const [open, setOpen] = useState(false)
  const s = SEVERITY[f.severity]
  return (
    <Card className={`p-5 ${f.severity === 'critical' ? 'ring-red-200' : 'ring-amber-200'}`}>
      <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
        <span className={`h-2 w-2 rounded-full ${s.dot} ${f.severity === 'critical' ? 'animate-pulse' : ''}`} />
        {f.title}
      </div>
      {f.key && (
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-4xl font-semibold tracking-tight">{f.key}</span>
          {f.key_note && <span className="text-sm text-slate-500">{f.key_note}</span>}
        </div>
      )}
      <p className="mt-2 text-sm text-slate-600">{f.plain}</p>
      <button onClick={() => setOpen(!open)} className="mt-3 text-xs font-medium text-slate-400 hover:text-slate-800">
        {open ? 'Скрыть' : 'Подробнее'}
      </button>
      {open && <Details f={f} />}
    </Card>
  )
}

function NoteRow({ f }: { f: Finding }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t border-slate-100 first:border-t-0">
      <button onClick={() => setOpen(!open)} className="flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-slate-50 sm:items-center">
        <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full sm:mt-0 ${SEVERITY[f.severity].dot}`} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
          <span className="text-sm font-medium sm:w-56 sm:shrink-0">{f.title}</span>
          <span className="text-sm font-semibold tabular-nums sm:w-20 sm:shrink-0">{f.key ?? ''}</span>
          <span className="text-sm text-slate-500 sm:min-w-0 sm:flex-1">{f.plain}</span>
        </span>
        <span className="text-xs text-slate-300">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="px-5 pb-4"><Details f={f} /></div>}
    </div>
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
  const shown = area ? findings.filter((f) => f.area === area) : findings
  const problems = shown.filter((f) => f.severity === 'critical' || f.severity === 'warn')
  const notes = shown.filter((f) => f.severity === 'info' || f.severity === 'ok')

  return (
    <div className="space-y-6">
      <Route facts={facts} findings={findings} selected={area} onSelect={setArea} />

      {problems.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Главные проблемы</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {problems.map((f) => <ProblemCard key={f.id} f={f} />)}
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-3 text-lg font-semibold">Что ещё видно в данных</h2>
        <Card className="overflow-hidden">
          {notes.map((f) => <NoteRow key={f.id} f={f} />)}
          {shown.length === 0 && <div className="p-5 text-sm text-slate-500">По этому участку в данных ТЗ нет записей.</div>}
        </Card>
      </div>

      <details className="group">
        <summary className="cursor-pointer list-none text-sm font-medium text-slate-500 hover:text-slate-800">
          <span className="group-open:hidden">+ Показать исходные таблицы из ТЗ</span><span className="hidden group-open:inline">− Скрыть исходные таблицы</span>
        </summary>
        <div className="mt-3"><RawTables facts={facts} /></div>
      </details>
    </div>
  )
}
