import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef } from 'react'
import { addDays, longDate, todayISO } from './dates'

/** Выбор даты смены: ‹ дата › и календарь. Будущее недоступно. */
export default function DatePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const today = todayISO()
  return (
    <div className="flex items-center rounded-xl bg-white shadow-sm ring-1 ring-black/[0.07]">
      <button onClick={() => onChange(addDays(value, -1))} className="rounded-l-xl px-2 py-2 text-slate-500 hover:bg-slate-50 hover:text-slate-900" aria-label="Предыдущая смена"><ChevronLeft size={16} /></button>
      <button onClick={() => input.current?.showPicker?.()} className="relative flex items-center gap-2 px-2 py-2 text-sm font-medium">
        <CalendarDays size={16} className="text-slate-500" />
        <span className="whitespace-nowrap">{longDate(value)}</span>
        <input ref={input} type="date" value={value} max={today} onChange={(e) => e.target.value && onChange(e.target.value)} className="pointer-events-none absolute inset-0 opacity-0" tabIndex={-1} aria-hidden />
      </button>
      <button disabled={value >= today} onClick={() => onChange(addDays(value, 1))} className="rounded-r-xl px-2 py-2 text-slate-500 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-30" aria-label="Следующая смена"><ChevronRight size={16} /></button>
    </div>
  )
}
