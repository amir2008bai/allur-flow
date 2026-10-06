import type { ReactNode } from 'react'
import type { Severity, Source } from './types'

export const SOURCE_LABEL: Record<Source, string> = {
  fact: 'факт', calc: 'расчёт', assumption: 'допущение', sim: 'симуляция', forecast: 'прогноз', feedback: 'ответ человека',
}

const SOURCE_STYLE: Record<Source, string> = {
  fact: 'bg-slate-100 text-slate-600 ring-slate-200',
  calc: 'bg-sky-50 text-sky-700 ring-sky-200',
  assumption: 'bg-amber-50 text-amber-700 ring-amber-200',
  sim: 'bg-violet-50 text-violet-700 ring-violet-200',
  forecast: 'bg-teal-50 text-teal-700 ring-teal-200',
  feedback: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
}

export function SourceBadge({ source }: { source: Source }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ring-inset ${SOURCE_STYLE[source]}`}>
      {SOURCE_LABEL[source]}
    </span>
  )
}

// ISA-101: нейтральный серый по умолчанию, цвет — только для отклонений
export const SEVERITY: Record<Severity, { dot: string; ring: string; label: string }> = {
  critical: { dot: 'bg-red-500', ring: 'ring-red-200', label: 'Критично' },
  warn: { dot: 'bg-amber-500', ring: 'ring-amber-200', label: 'Внимание' },
  info: { dot: 'bg-slate-400', ring: 'ring-slate-200', label: 'К сведению' },
  ok: { dot: 'bg-emerald-500', ring: 'ring-slate-200', label: 'В норме' },
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[22px] bg-white shadow-[0_1px_1px_rgba(0,0,0,0.03),0_8px_24px_-12px_rgba(15,23,42,0.12)] ring-1 ring-black/[0.06] ${className}`}>{children}</div>
}

export function fmt(v: number | string) {
  return typeof v === 'number' ? v.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) : v
}
