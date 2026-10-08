import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Play, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { longDate, todayISO } from '../dates'
import { Card, SourceBadge } from '../ui'
import { useView } from './store'

interface DayCell { day: string; fact: number; plan: number; pct: number; hits: number; today: boolean; scenario: string }
interface Month { month: string; days_in_month: number; first_weekday: number; days: DayCell[]; fact: number; plan_to_date: number; plan_month: number; corridor_hits: number; shifts_total: number }
interface ShiftRec { shift: number; plan: number; fact: number; forecast: { mean: number; lo: number; hi: number; p_plan: number }; in_corridor: boolean }
interface DayRec {
  day: string; scenario: string; conditions: string; plan: number; fact: number; pct: number; shifts: ShiftRec[]
  losses: { station: string; name: string; reason: string; minutes: number }[]; downtime_min: number; paint_defect_pct: number; oee_pct: number; saved_at: number
}

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const WD = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']
const int = (x: number) => Math.round(x).toLocaleString('ru-RU')
/** Цвет дня по выполнению плана: ≥100% — зелёный, 90–99% — янтарный, <90% — красный (палитра статусов). */
const dayTone = (p: number) => (p >= 100 ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : p >= 90 ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-red-50 text-red-700 ring-red-200')
const dot = (p: number) => (p >= 100 ? 'bg-emerald-500' : p >= 90 ? 'bg-amber-500' : 'bg-red-500')
const shiftMonth = (m: string, k: number) => { const [y, mm] = m.split('-').map(Number); const d = new Date(y, mm - 1 + k, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

/** Журнал смен: календарь месяца с выполнением плана по дням и отчёт выбранного дня (утренний прогноз против факта). */
export default function MonthJournal() {
  const date = useView((v) => v.date)
  const setDate = useView((v) => v.setDate)
  const setScenario = useView((v) => v.setScenario)
  const today = todayISO()
  const [month, setMonth] = useState(date.slice(0, 7))
  const [m, setM] = useState<Month | null>(null)
  const [rec, setRec] = useState<DayRec | null>(null)

  useEffect(() => { setMonth(date.slice(0, 7)) }, [date])
  useEffect(() => {
    let alive = true
    fetch(`/api/journal/month?month=${month}&today=${today}`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive) setM(d) }).catch(() => {})
    return () => { alive = false }
  }, [month, today])
  useEffect(() => {
    let alive = true
    setRec(null)
    fetch(`/api/journal/day?date=${date}`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive) setRec(d) }).catch(() => {})
    return () => { alive = false }
  }, [date])

  const replay = () => {
    if (!rec) return
    setScenario(rec.scenario)
    const v = useView.getState(); v.setT(0); v.setPlaying(true)
    document.getElementById('twin-viewer')?.scrollIntoView({ behavior: 'smooth' })
  }

  if (!m) return null
  const byDay = Object.fromEntries(m.days.map((d) => [Number(d.day.slice(8)), d]))
  const cells: (number | null)[] = [...Array(m.first_weekday).fill(null), ...Array.from({ length: m.days_in_month }, (_, i) => i + 1)]
  const [y, mm] = month.split('-').map(Number)
  const pctToDate = m.plan_to_date ? (100 * m.fact) / m.plan_to_date : 0

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-700"><CalendarDays size={18} /></span>
          <div>
            <h2 className="text-lg font-semibold leading-tight">Журнал смен</h2>
            <p className="text-sm text-slate-500">Каждый день записывается: план, факт и что двойник предсказывал утром.</p>
          </div>
        </div>
        <SourceBadge source="sim" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* календарь месяца */}
        <div className="w-full max-w-[380px]">
          <div className="mb-2 flex items-center justify-between">
            <button onClick={() => setMonth(shiftMonth(month, -1))} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Предыдущий месяц"><ChevronLeft size={16} /></button>
            <div className="text-sm font-semibold">{MONTHS[mm - 1]} {y}</div>
            <button onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= today.slice(0, 7)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label="Следующий месяц"><ChevronRight size={16} /></button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-slate-400">{WD.map((w) => <div key={w}>{w}</div>)}</div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {cells.map((n, i) => {
              if (n == null) return <div key={`e${i}`} />
              const d = byDay[n]
              const iso = `${month}-${String(n).padStart(2, '0')}`
              const sel = iso === date
              if (!d) return <div key={iso} className="grid aspect-square place-items-center rounded-lg text-xs text-slate-300">{n}</div>
              return (
                <button key={iso} onClick={() => setDate(iso)} title={`${int(d.fact)} из ${d.plan} · ${Math.round(d.pct)}%`}
                  className={`flex aspect-square flex-col items-center justify-center rounded-lg text-xs ring-1 transition active:scale-95 ${dayTone(d.pct)} ${sel ? 'ring-2 ring-sky-400' : ''}`}>
                  <span className="font-semibold leading-none">{n}</span>
                  <span className="mt-0.5 text-[10px] tabular-nums leading-none opacity-80">{Math.round(d.pct)}%</span>
                </button>
              )
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />план выполнен</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />90–99%</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" />меньше 90%</span>
          </div>
          <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-sm ring-1 ring-slate-100">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-slate-500">С 1-го числа</span>
              <span className="tabular-nums"><b>{int(m.fact)}</b> из {int(m.plan_to_date)} · <b className={pctToDate >= 100 ? 'text-emerald-600' : pctToDate >= 95 ? 'text-amber-600' : 'text-red-600'}>{Math.round(pctToDate)}%</b></span>
            </div>
            <div className="mt-1 text-xs text-slate-500">План месяца {int(m.plan_month)} (ТЗ) · прогноз утром попал в коридор в {m.corridor_hits} из {m.shifts_total} смен</div>
          </div>
        </div>

        {/* отчёт дня */}
        <div className="min-w-0">
          {!rec ? <div className="text-sm text-slate-400">Загружаю запись дня…</div> : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="font-semibold first-letter:uppercase">{longDate(rec.day)}</div>
                <div className="flex items-center gap-1.5 text-sm"><span className={`h-2 w-2 rounded-full ${dot(rec.pct)}`} /><b className="tabular-nums">{int(rec.fact)}</b> из {rec.plan} · {Math.round(rec.pct)}%</div>
              </div>
              <div className="mt-0.5 text-xs text-slate-500">Условия: {rec.conditions}</div>

              <div className="mt-3 divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
                <div className="grid grid-cols-[64px_56px_minmax(0,1fr)_24px] gap-2 px-3 py-1.5 text-[11px] text-slate-400"><span>смена</span><span className="text-right">факт</span><span>прогноз утром</span><span /></div>
                {rec.shifts.map((s) => (
                  <div key={s.shift} className="grid grid-cols-[64px_56px_minmax(0,1fr)_24px] items-center gap-2 px-3 py-2 text-sm">
                    <span className="text-slate-600">{s.shift === 1 ? '08–16' : '16–24'}</span>
                    <span className={`text-right font-semibold tabular-nums ${s.fact >= s.plan ? 'text-emerald-600' : 'text-slate-900'}`}>{int(s.fact)}</span>
                    <span className="truncate text-xs tabular-nums text-slate-500">{int(s.forecast.mean)} ({int(s.forecast.lo)}–{int(s.forecast.hi)}) · план {s.plan}</span>
                    {s.in_corridor ? <CheckCircle2 size={15} className="text-emerald-600" aria-label="факт в коридоре прогноза" /> : <XCircle size={15} className="text-amber-500" aria-label="факт вне коридора прогноза" />}
                  </div>
                ))}
              </div>

              <div className="mt-3 text-xs font-medium text-slate-600">Что съело машины · простои {int(rec.downtime_min)} мин</div>
              {rec.losses.length === 0 ? <div className="mt-1 text-sm text-slate-400">внеплановых остановок не было</div> : (
                <ul className="mt-1.5 space-y-1">
                  {rec.losses.slice(0, 3).map((l) => (
                    <li key={l.station + l.reason} className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate"><b className="font-medium">{l.name}</b> <span className="text-slate-500">— {l.reason}</span></span>
                      <span className="shrink-0 tabular-nums text-slate-600">{int(l.minutes)} мин</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 text-xs text-slate-500">Брак окраски {String(rec.paint_defect_pct).replace('.', ',')}% · OEE {rec.oee_pct}%</div>

              <button onClick={replay} className="mt-3 flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700 active:scale-[.98]"><Play size={14} />Пересмотреть день</button>
              <p className="mt-2 text-[11px] text-slate-400">Запись сохранена {new Date(rec.saved_at * 1000).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}. Сейчас дни — симуляция; с данными завода сюда придут реальные смены.</p>
            </>
          )}
        </div>
      </div>
    </Card>
  )
}
