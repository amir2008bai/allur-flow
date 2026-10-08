import { ArrowRight, CalendarDays, ClipboardCheck, Printer, ShieldAlert, Sunrise, Wrench } from 'lucide-react'
import { useEffect, useState } from 'react'
import { longDate, todayISO } from './dates'
import { tenge, useMoney } from './money'
import { Card, SourceBadge } from './ui'
import { useView } from './twin/store'

type Src = 'fact' | 'sim' | 'forecast' | 'calc'
interface ShiftF { shift: number; hours: string; plan: number; mean: number; lo: number; hi: number; p_plan: number }
interface Briefing {
  date: string; weekday: string; kind: 'work' | 'off' | 'maint'; note: string
  forecast: { shifts: ShiftF[]; day: { plan: number; mean: number; lo: number; hi: number; p_plan: number }; reps: number }
  action: { now_per_shift: number; plan_per_shift: number; gap: number; names: string[]; delta: number; ci: [number, number]; closes_gap: boolean; money: { month: number; once: number } | null }
  repair_order: { station: string; name: string; loss_per_min: number; loss_per_hour: number; limits_output: boolean }[]
  quality: { kind: 'special' | 'chronic' | 'ok'; title: string; text: string; pbar: number; norm: number }
  containment: string | null
  yesterday: { day: string; fact: number; plan: number; pct: number; conditions: string; norms: string[]; losses: { name: string; reason: string; minutes: number }[]; hits: number; shifts: number; source: string; has_facts: boolean } | null
  month: { fact: number; plan_to_date: number; mean: number; range: [number, number]; p_plan: number; plan: number; need_per_day: number | null; daily: number; by_days: number; by_models: number; remaining_days: number }
  capa: { action: string; start_day: string; verdict: string; title: string; demo: boolean }[]
  risks: { level: 'high' | 'medium' | 'low'; text: string; where: string; source: Src }[]
}

const int = (x: number) => Math.round(x).toLocaleString('ru-RU')
const n1 = (x: number) => x.toFixed(1).replace('.', ',')
const pct = (x: number) => `${Math.round(100 * x)}%`
const pTone = (p: number) => (p >= 0.8 ? 'text-emerald-600' : p >= 0.5 ? 'text-amber-600' : 'text-red-600')
const LEVEL = { high: 'bg-red-500', medium: 'bg-amber-500', low: 'bg-slate-400' }

/** Перейти на «Двойник» к нужному блоку: вкладка грузится лениво — ждём, пока блок появится. */
function useGo() {
  const setTab = useView((v) => v.setTab)
  return (anchor: string) => {
    setTab('twin')
    // блоки выше грузятся и сдвигают страницу: докручиваем, пока позиция блока не перестанет меняться
    let n = 0, lastTop = NaN, still = 0
    const t = setInterval(() => {
      const el = document.getElementById(anchor)
      n++
      if (el) {
        const top = el.getBoundingClientRect().top + window.scrollY
        still = Math.abs(top - lastTop) < 2 ? still + 1 : 0
        lastTop = top
        window.scrollTo({ top: top - 72 })
      }
      if (still >= 4 || n > 60) clearInterval(t)
    }, 200)
  }
}

function More({ to, label = 'подробнее' }: { to: string; label?: string }) {
  const go = useGo()
  return <button onClick={() => go(to)} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-900 print:hidden">{label}<ArrowRight size={12} /></button>
}

function Block({ icon, title, source, children }: { icon: React.ReactNode; title: string; source?: Src; children: React.ReactNode }) {
  return (
    <Card className="p-5 print:break-inside-avoid print:shadow-none">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><span className="text-slate-500">{icon}</span>{title}</div>
        {source && <SourceBadge source={source} />}
      </div>
      {children}
    </Card>
  )
}

/** Утренний брифинг начальника смены: прогноз, риски, что сделать, вчера и месяц — на одной странице. */
export default function BriefingPage() {
  const [b, setB] = useState<Briefing | null>(null)
  const [err, setErr] = useState(false)
  const money = useMoney()
  const today = todayISO()
  useEffect(() => {
    let alive = true
    fetch(`/api/briefing?today=${today}`).then((r) => { if (!r.ok) throw new Error(); return r.json() }).then((d) => alive && setB(d)).catch(() => alive && setErr(true))
    return () => { alive = false }
  }, [today])

  if (err) return <Card className="p-6 text-sm text-slate-500">Брифинг собирается на сервере — нет связи с сервером.</Card>
  if (!b) return <Card className="p-6 text-sm text-slate-500">Собираю брифинг: прогноз смен, риски, вчерашний день…</Card>
  const f = b.forecast
  const a = b.action
  const first = b.repair_order[0]
  const y = b.yesterday
  const m = b.month

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500"><Sunrise size={16} />Утренний брифинг · 08:00</div>
          <h1 className="text-2xl font-semibold tracking-tight first-letter:uppercase">{longDate(b.date)}</h1>
          {b.kind !== 'work' && <div className="mt-1 text-sm text-amber-700">{b.kind === 'off' ? 'По календарю сегодня выходной — прогноз дан для рабочего дня.' : 'Сегодня отмечено ТО 4 ч.'}</div>}
        </div>
        <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 active:scale-[.98] print:hidden"><Printer size={15} />Распечатать</button>
      </div>

      {/* прогноз смен и дня */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[...f.shifts.map((s) => ({ k: `Смена ${s.hours}`, ...s })), { k: 'Весь день', ...f.day, hours: '' }].map((s) => (
          <Card key={s.k} className="p-4 print:shadow-none">
            <div className="flex items-center justify-between text-xs text-slate-500">{s.k}<SourceBadge source="forecast" /></div>
            <div className="mt-1 flex items-baseline gap-2"><span className="text-3xl font-semibold tabular-nums">≈ {int(s.mean)}</span><span className="text-sm text-slate-500">из {s.plan}</span></div>
            <div className="text-xs tabular-nums text-slate-500">обычно {int(s.lo)}–{int(s.hi)}</div>
            <div className={`mt-1 text-sm font-semibold ${pTone(s.p_plan)}`}>план — вероятность {pct(s.p_plan)}</div>
          </Card>
        ))}
      </div>
      <p className="-mt-1 text-[11px] text-slate-400">{b.note} Прогноз — {f.reps} прогонов двойника обычного дня.</p>

      {/* риски */}
      <Block icon={<ShieldAlert size={16} />} title="Главные риски сегодня">
        {b.risks.length === 0 ? <div className="text-sm text-emerald-700">Серьёзных рисков нет.</div> : (
          <ul className="space-y-2">
            {b.risks.map((r) => (
              <li key={r.text} className="flex items-start gap-2.5 text-sm">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${LEVEL[r.level]}`} />
                <span className="min-w-0 flex-1">{r.text}</span>
                <span className="shrink-0 print:hidden"><SourceBadge source={r.source as Src} /></span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      {/* что сделать */}
      <Block icon={<Wrench size={16} />} title="Что сделать сегодня">
        <ol className="space-y-3 text-sm">
          <li>
            <b>1. Главное действие.</b>{' '}
            {a.names.length ? <>
              {a.names.join(' + ')}: <b className="text-emerald-700">+{n1(a.delta)} машины за смену</b> <span className="text-xs text-slate-500">({n1(a.ci[0])}…{n1(a.ci[1])})</span>
              {' '}≈ <b>{tenge(a.delta * money.margin)}</b> за смену{a.closes_gap ? ' — план смены выполняется' : ''}.
              {a.money && <span className="text-xs text-slate-500"> Затраты: {tenge(a.money.month)} в месяц{a.money.once ? `, разово ${tenge(a.money.once)}` : ''}.</span>}
            </> : 'Ни одно действие не даёт подтверждённого прироста — работаем в обычном режиме.'}
            {' '}<SourceBadge source="sim" />
            <div><More to="actions" label="все действия" /></div>
          </li>
          {first && (
            <li>
              <b>2. Если сломается несколько участков сразу</b> — ремонт по порядку: {b.repair_order.map((r) => `${r.name.toLowerCase()} (${tenge(r.loss_per_min * money.margin)}/мин)`).join(' → ')}.
              {' '}<SourceBadge source="sim" />
              <div><More to="station-value" /></div>
            </li>
          )}
          {b.containment && (
            <li>
              <b>3. Брак окраски.</b> {b.quality.title}. {b.containment}
              {' '}<SourceBadge source="calc" />
              <div><More to="paint-spc" label="контрольная карта" /></div>
            </li>
          )}
        </ol>
      </Block>

      <div className="grid gap-4 lg:grid-cols-2">
        {y && (
          <Block icon={<CalendarDays size={16} />} title={`Вчера · ${longDate(y.day)}`} source={y.has_facts ? 'fact' : 'sim'}>
            <div className="text-sm">
              <b className="tabular-nums">{int(y.fact)}</b> из {y.plan} ({Math.round(y.pct)}%) · утренний прогноз попал в коридор в {y.hits} из {y.shifts} смен
            </div>
            <div className="mt-1 text-xs text-slate-500">{y.conditions}</div>
            {y.losses.length > 0 && <div className="mt-1 text-xs text-slate-600">Больше всего съело: {y.losses.map((l) => `${l.name.toLowerCase()} — ${l.reason.toLowerCase()} ${l.minutes} мин`).join('; ')}</div>}
            {y.norms.length > 0 && <ul className="mt-1.5 space-y-0.5 text-xs text-red-700">{y.norms.map((n) => <li key={n}>• {n}</li>)}</ul>}
            <More to="journal" label="журнал" />
          </Block>
        )}
        <Block icon={<CalendarDays size={16} />} title="Месяц" source="forecast">
          <div className="text-sm">
            Сделано <b className="tabular-nums">{int(m.fact)}</b> из {int(m.plan_to_date)} · к концу месяца ≈ <b className="tabular-nums">{int(m.mean)}</b> <span className="text-xs text-slate-500">(обычно {int(m.range[0])}–{int(m.range[1])})</span>
          </div>
          <div className={`mt-1 text-sm font-semibold ${pTone(m.p_plan)}`}>цель {int(m.plan)}: вероятность {pct(m.p_plan)}{m.need_per_day ? ` · нужно ≈ ${int(m.need_per_day)} в день при плане ${m.daily}` : ''}</div>
          <div className="mt-1 text-xs text-amber-800">План в ТЗ не согласован: «не менее {int(m.plan)}», по дням {int(m.by_days)}, по моделям {int(m.by_models)} — это несогласованность плана, а не недовыпуск.</div>
          <More to="journal" label="календарь месяца" />
        </Block>
      </div>

      {b.capa.length > 0 && (
        <Block icon={<ClipboardCheck size={16} />} title="Разбор брака: проверка действий" source="calc">
          <ul className="space-y-1 text-sm">
            {b.capa.map((c) => <li key={c.action + c.start_day}><b>{c.action}</b> — {c.title}{c.demo ? ' (демо на днях двойника)' : ''}</li>)}
          </ul>
          <More to="capa" />
        </Block>
      )}
    </div>
  )
}
