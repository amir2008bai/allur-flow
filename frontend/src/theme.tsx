// Единая палитра статусов для всего сервиса: 3D, План, Схема, полосы, легенды, панели.
import { Hourglass } from 'lucide-react'

export type Status = 'working' | 'starved' | 'blocked' | 'down'

export const STATUS: Record<Status, { hex: string; label: string }> = {
  working: { hex: '#22c55e', label: 'работает' },
  starved: { hex: '#cbd5e1', label: 'ждёт кузов' },
  blocked: { hex: '#f59e0b', label: 'некуда отдать' },
  down: { hex: '#ef4444', label: 'стоит' },
}
export const BOTTLENECK_HEX = '#7c3aed'

export function Dot({ status, pulse = false }: { status: Status; pulse?: boolean }) {
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${pulse ? 'animate-pulse' : ''}`} style={{ background: STATUS[status].hex }} />
}

export function BottleneckBadge({ size = 14 }: { size?: number }) {
  return (
    <span className="inline-grid place-items-center rounded-full text-white" style={{ background: BOTTLENECK_HEX, width: size + 6, height: size + 6 }} title="узкое место">
      <Hourglass size={size - 2} strokeWidth={2.4} />
    </span>
  )
}

/** Одна легенда на весь сервис. */
export function StatusLegend({ bottleneck = true, className = '' }: { bottleneck?: boolean; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600 ${className}`}>
      {(Object.keys(STATUS) as Status[]).map((s) => (
        <span key={s} className="flex items-center gap-1.5"><Dot status={s} />{STATUS[s].label}</span>
      ))}
      {bottleneck && <span className="flex items-center gap-1.5"><BottleneckBadge size={10} />узкое место</span>}
    </div>
  )
}
