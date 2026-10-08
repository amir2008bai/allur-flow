import { AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Play, Wrench, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { longDate, todayISO } from '../dates'
import { Card, SourceBadge } from '../ui'
import { useView } from './store'

type Kind = 'work' | 'off' | 'maint'
interface DayCell { day: string; kind: Kind; fact?: number; plan?: number; pct?: number; hits?: number; norms?: number; today?: boolean; forecast?: number; lo?: number; hi?: number }
interface Month {
  month: string; days_in_month: number; first_weekday: number; days: DayCell[]; fact: number; plan_to_date: number; corridor_hits: number; shifts_total: number
  forecast: { total_mean: number; total_range: [number, number]; p_plan: number; remaining_days: number }
  plans: { month: number; by_days: number; by_models: number; work_days: number; need_per_day: number | null; daily: number }
}
interface ShiftRec { shift: number; plan: number; fact: number; forecast: { mean: number; lo: number; hi: number; p_plan: number }; in_corridor: boolean }
interface DayRec {
  day: string; kind: Kind; scenario?: string; conditions?: string; plan?: number; fact?: number; pct?: number; shifts?: ShiftRec[]
  losses?: { station: string; name: string; reason: string; minutes: number }[]; downtime_min?: number; paint_defect_pct?: number; oee_pct?: number
  norms?: { kind: string; text: string }[]; saved_at?: number
}

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const WD = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']
const int = (x: number) => Math.round(x).toLocaleString('ru-RU')
/** Цвет дня по выполнению плана: ≥100% — зелёный, 90–99% — янтарный, <90% — красный (палитра статусов). */
const dayTone = (p: number) => (p >= 100 ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : p >= 90 ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-red-50 text-red-700 ring-red-200')
const dot = (p: number) => (p >= 100 ? 'bg-emerald-500' : p >= 90 ? 'bg-amber-500' : 'bg-red-500')
const shiftMonth = (m: string, k: number) => { const [y, mm] = m.split('-').map(Number); const d = new Date(y, mm - 1 + k, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const KIND_RU: Record<Kind, string> = { work: 'Рабочий', off: 'Выходной', maint: 'ТО 4 ч' }

/** Журнал смен и прогноз месяца: прошедшие дни — запись (план, факт, утренний прогноз), будущие — прогноз двойника.
 *  Будущий день можно отметить: рабочий / выходной / ТО 4 ч — прогноз месяца пересчитается. */
export default function MonthJournal() {
  const date = useView((v) => v.date)
  const setDate = useView((v) => v.setDate)
  const setScenario = useView((v) => v.setScenario)
  const today = todayISO()
  const [month, setMonth] = useState(date.slice(0, 7))
  const [m, setM] = useState<Month | null>(null)
  const [rec, setRec] = useState<DayRec | null>(null)
  const [future, setFuture] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => { setMonth(date.slice(0, 7)) }, [date])
  useEffect(() => {
    let alive = true
    fetch(`/api/journal/month?month=${month}&today=${today}`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive) setM(d) }).catch(() => {})
    return () => { alive = false }
  }, [month, today, tick])
  useEffect(() => {
    let alive = true
    setRec(null)
    fetch(`/api/journal/day?date=${date}`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive) setRec(d) }).catch(() => {})
    return () => { alive = false }
  }, [date])

  const replay = () => {
    if (!rec?.scenario) return
    setScenario(rec.scenario)
    const v = useView.getState(); v.setT(0); v.setPlaying(true)
    document.getElementById('twin-viewer')?.scrollIntoView({ behavior: 'smooth' })
  }
  const markDay = async (day: string, kind: Kind | 'auto') => {
    await fetch('/api/journal/mark', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ day, kind, today }) }).catch(() => {})
    setTick((x) => x + 1)
  }

  if (!m) return <Card className="p-5 text-sm text-slate-500">Собираю журнал месяца…</Card>
  const byDay = Object.fromEntries(m.days.map((d) => [Number(d.day.slice(8)), d]))
  const cells: (number | null)[] = [...Array(m.first_weekday).fill(null), ...Array.from({ length: m.days_in_month }, (_, i) => i + 1)]
  const [y, mm] = month.split('-').map(Number)
  const pctToDate = m.plan_to_date ? (100 * m.fact) / m.plan_to_date : 0
  const fc = m.forecast
  const fd = future ? m.days.find((d) => d.day === future) : null

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-700"><CalendarDays size={18} /></span>
          <div>
            <h2 className="text-lg font-semibold leading-tight">Журнал и прогноз месяца</h2>
            <p className="text-sm text-slate-500">Прошедшие дни — запись смен. Будущие — прогноз двойника.</p>
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
              const isFuture = iso > today
              const sel = iso === (isFuture ? future : date)
              if (!d) return <div key={iso} className="grid aspect-square place-items-center rounded-lg text-xs text-slate-300">{n}</div>
              const base = 'flex aspect-square flex-col items-center justify-center rounded-lg text-xs ring-1 transition active:scale-95'
              const ring = sel ? ' ring-2 ring-sky-400' : ''
              if (d.kind === 'off') return (
                <button key={iso} onClick={() => (isFuture ? setFuture(iso) : undefined)} disabled={!isFuture} title="выходной"
                  className={`${base} bg-slate-50 text-slate-400 ring-slate-100${ring}`}><span className="leading-none">{n}</span><span className="mt-0.5 text-[9px] leading-none">вых</span></button>
              )
              if (isFuture) return (
                <button key={iso} onClick={() => setFuture(iso)} title={`прогноз ≈ ${int(d.forecast ?? 0)} (${int(d.lo ?? 0)}–${int(d.hi ?? 0)})`}
                  className={`${base} border border-dashed border-slate-200 bg-white text-slate-500 ring-transparent${ring}`}>
                  <span className="leading-none">{n}</span>
                  <span className="mt-0.5 flex items-center gap-0.5 text-[10px] tabular-nums leading-none text-slate-400">{d.kind === 'maint' && <Wrench size={9} />}≈{int(d.forecast ?? 0)}</span>
                </button>
              )
              return (
                <button key={iso} onClick={() => { setFuture(null); setDate(iso) }} title={`${int(d.fact ?? 0)} из ${d.plan} · ${Math.round(d.pct ?? 0)}%`}
                  className={`${base} ${dayTone(d.pct ?? 0)}${ring}`}>
                  <span className="relative font-semibold leading-none">{n}{(d.norms ?? 0) > 0 && <span className="absolute -right-1.5 -top-1 h-1.5 w-1.5 rounded-full bg-red-500" />}</span>
                  <span className="mt-0.5 text-[10px] tabular-nums leading-none opacity-80">{Math.round(d.pct ?? 0)}%</span>
                </button>
              )
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />план выполнен</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />90–99%</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" />меньше 90% · точка — нарушена норма</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded border border-dashed border-slate-300" />прогноз</span>
          </div>
        </div>

        {/* правая колонка: прогноз месяца + отчёт дня */}
        <div className="min-w-0 space-y-4">
          <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-xs text-slate-500">К концу месяца <SourceBadge source="forecast" /></span>
              <span className={`text-sm font-semibold ${fc.p_plan >= 0.7 ? 'text-emerald-600' : fc.p_plan >= 0.3 ? 'text-amber-600' : 'text-red-600'}`}>
                план {int(m.plans.month)}: {fc.p_plan >= 0.995 ? 'выполним' : fc.p_plan <= 0.005 ? 'не выполним' : `вероятность ${Math.round(100 * fc.p_plan)}%`}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
              <span className="text-3xl font-semibold tabular-nums">≈ {int(fc.total_mean)}</span>
              <span className="text-sm tabular-nums text-slate-500">обычно {int(fc.total_range[0])}–{int(fc.total_range[1])}</span>
            </div>
            <div className="mt-1 text-xs tabular-nums text-slate-500">
              сделано {int(m.fact)} из {int(m.plan_to_date)} ({Math.round(pctToDate)}%) · осталось {fc.remaining_days} раб. дн.
              {m.plans.need_per_day != null && m.plans.need_per_day > 0 && <> · для {int(m.plans.month)} нужно ≈ {int(m.plans.need_per_day)}/день при плане {m.plans.daily}</>}
            </div>
            <div className="mt-2 flex items-start gap-1.5 rounded-xl bg-white px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>План в ТЗ не сходится: «не менее {int(m.plans.month)}» · по дневному плану {m.plans.daily} × {m.plans.work_days} раб. дн. = {int(m.plans.by_days)} · по моделям {int(m.plans.by_models)}. Это несогласованность плана, а не недовыпуск.</span>
            </div>
            <div className="mt-1.5 text-[11px] text-slate-400">Утренний прогноз смены попадал в коридор в {m.corridor_hits} из {m.shifts_total} смен · будущие дни — 240 типичных дней двойника (штатные, с авариями, с засором фильтра)</div>
          </div>

          {fd && future ? (
            <div className="rounded-2xl p-4 ring-1 ring-slate-200">
              <div className="font-semibold first-letter:uppercase">{longDate(future)}</div>
              <div className="mt-0.5 text-sm text-slate-500">{fd.kind === 'off' ? 'Выходной' : <>Прогноз ≈ <b className="text-slate-900">{int(fd.forecast ?? 0)}</b> машин (обычно {int(fd.lo ?? 0)}–{int(fd.hi ?? 0)}) · план {m.plans.daily}</>}</div>
              <div className="mt-3 text-xs text-slate-500">Отметить день — прогноз месяца пересчитается:</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(['work', 'maint', 'off'] as const).map((k) => (
                  <button key={k} onClick={() => markDay(future, k)} className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 transition active:scale-95 ${fd.kind === k ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-100'}`}>
                    {k === 'maint' && <Wrench size={12} />}{KIND_RU[k]}
                  </button>
                ))}
                <button onClick={() => markDay(future, 'auto')} className="rounded-lg px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-100">по умолчанию</button>
              </div>
            </div>
          ) : !rec ? <div className="text-sm text-slate-400">Загружаю запись дня…</div> : rec.kind === 'off' ? (
            <div className="rounded-2xl p-4 text-sm text-slate-500 ring-1 ring-slate-200"><div className="font-semibold text-slate-900 first-letter:uppercase">{longDate(rec.day)}</div>Выходной — смен не было.</div>
          ) : (
            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="font-semibold first-letter:uppercase">{longDate(rec.day)}</div>
                <div className="flex items-center gap-1.5 text-sm"><span className={`h-2 w-2 rounded-full ${dot(rec.pct ?? 0)}`} /><b className="tabular-nums">{int(rec.fact ?? 0)}</b> из {rec.plan} · {Math.round(rec.pct ?? 0)}%</div>
              </div>
              <div className="mt-0.5 text-xs text-slate-500">Условия: {rec.conditions}</div>

              <div className="mt-3 divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
                <div className="grid grid-cols-[64px_56px_minmax(0,1fr)_24px] gap-2 px-3 py-1.5 text-[11px] text-slate-400"><span>смена</span><span className="text-right">факт</span><span>прогноз утром</span><span /></div>
                {rec.shifts?.map((s) => (
                  <div key={s.shift} className="grid grid-cols-[64px_56px_minmax(0,1fr)_24px] items-center gap-2 px-3 py-2 text-sm">
                    <span className="text-slate-600">{s.shift === 1 ? '08–16' : '16–24'}</span>
                    <span className={`text-right font-semibold tabular-nums ${s.fact >= s.plan ? 'text-emerald-600' : 'text-slate-900'}`}>{int(s.fact)}</span>
                    <span className="truncate text-xs tabular-nums text-slate-500">{int(s.forecast.mean)} ({int(s.forecast.lo)}–{int(s.forecast.hi)}) · план {s.plan}</span>
                    {s.in_corridor ? <CheckCircle2 size={15} className="text-emerald-600" aria-label="факт в коридоре прогноза" /> : <XCircle size={15} className="text-amber-500" aria-label="факт вне коридора прогноза" />}
                  </div>
                ))}
              </div>

              {(rec.norms?.length ?? 0) > 0 && (
                <ul className="mt-3 space-y-1">
                  {rec.norms!.map((n) => <li key={n.text} className="flex items-start gap-1.5 text-xs text-red-700"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{n.text}</li>)}
                </ul>
              )}

              <div className="mt-3 text-xs font-medium text-slate-600">Что съело машины · простои {int(rec.downtime_min ?? 0)} мин</div>
              {(rec.losses?.length ?? 0) === 0 ? <div className="mt-1 text-sm text-slate-400">внеплановых остановок не было</div> : (
                <ul className="mt-1.5 space-y-1">
                  {rec.losses!.slice(0, 3).map((l) => (
                    <li key={l.station + l.reason} className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate"><b className="font-medium">{l.name}</b> <span className="text-slate-500">— {l.reason}</span></span>
                      <span className="shrink-0 tabular-nums text-slate-600">{int(l.minutes)} мин</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 text-xs text-slate-500">Брак окраски {String(rec.paint_defect_pct).replace('.', ',')}% · OEE {rec.oee_pct}%</div>

              <button onClick={replay} className="mt-3 flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700 active:scale-[.98]"><Play size={14} />Пересмотреть день</button>
              <p className="mt-2 text-[11px] text-slate-400">Запись сохранена {new Date((rec.saved_at ?? 0) * 1000).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}. Сейчас дни — симуляция; с данными завода сюда придут реальные смены.</p>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
