import { ArrowRight, Printer, Sunrise } from 'lucide-react'
import { useEffect, useState } from 'react'
import { longDate, todayISO } from './dates'
import { tenge, useMoney } from './money'
import { Card, SourceBadge } from './ui'
import { SECTION_OF, useView } from './twin/store'
import { t } from './i18n'

type Src = 'fact' | 'sim' | 'forecast' | 'calc'
interface ShiftF { shift: number; hours: string; plan: number; mean: number; lo: number; hi: number; p_plan: number }
interface Briefing {
  date: string; kind: 'work' | 'off' | 'maint'; note: string
  outlook?: { bottleneck_name: string; bottleneck_share: number; down_name: string; down_min: number; p_down_over_limit: number }
  forecast: { shifts: ShiftF[]; day: { plan: number; mean: number; lo: number; hi: number; p_plan: number }; reps: number }
  action: { names: string[]; delta: number; closes_gap: boolean; money: { month: number; once: number } | null }
  repair_order: { station: string; name: string; loss_per_min: number }[]
  quality: { kind: 'special' | 'chronic' | 'ok' }
  containment: string | null
  yesterday: { day: string; fact: number; plan: number; pct: number; has_facts: boolean } | null
  month: { fact: number; plan_to_date: number; mean: number; plan: number; need_per_day: number | null; daily: number }
  risks: { level: 'high' | 'medium' | 'low'; text: string; detail?: string; note?: string; where: string; source: Src }[]
}

const int = (x: number) => Math.round(x).toLocaleString('ru-RU')
const n1 = (x: number) => x.toFixed(1).replace('.', ',')
const chance = (p: number) => `${Math.round(100 * p)}%`
const tone = (p: number) => (p >= 0.8 ? 'text-emerald-600' : p >= 0.5 ? 'text-amber-600' : 'text-red-600')
const DOT = { high: 'bg-red-500', medium: 'bg-amber-500', low: 'bg-slate-400' }
const MAX_RISKS = 3
const GEN: Record<string, string> = { welding: 'сварки', paint: 'окраски', assembly: 'сборки', qc: 'ОТК' }
const low1 = (t: string) => t.charAt(0).toLowerCase() + t.slice(1)

/** Перейти на «Двойник» к нужному блоку: блоки выше грузятся и сдвигают страницу — докручиваем, пока позиция не устоится. */
function useGo() {
  const setTab = useView((v) => v.setTab)
  const setSection = useView((v) => v.setSection)
  return (anchor: string) => {
    setSection(SECTION_OF[anchor] ?? 'now')
    setTab('twin')
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

function Go({ to }: { to: string }) {
  const go = useGo()
  return <button onClick={() => go(to)} aria-label="Подробнее" title="Подробнее" className="ml-1 inline-flex shrink-0 rounded-md p-0.5 text-sky-600 hover:bg-sky-50 hover:text-sky-800 print:hidden"><ArrowRight size={14} /></button>
}

/** Утренний брифинг начальника смены: коротко — сколько сделаем, что мешает, что сделать. */
export default function BriefingPage() {
  const [b, setB] = useState<Briefing | null>(null)
  const [err, setErr] = useState(false)
  const [allRisks, setAllRisks] = useState(false)
  const money = useMoney()
  const today = todayISO()
  useEffect(() => {
    let alive = true
    fetch(`/api/briefing?today=${today}`).then((r) => { if (!r.ok) throw new Error(); return r.json() }).then((d) => alive && setB(d)).catch(() => alive && setErr(true))
    return () => { alive = false }
  }, [today])

  if (err) return <Card className="p-6 text-sm text-slate-500">Брифинг собирается на сервере — нет связи с сервером.</Card>
  if (!b) return <Card className="p-6 text-sm text-slate-500">Собираю брифинг…</Card>
  const d = b.forecast.day
  const a = b.action
  const y = b.yesterday
  const m = b.month
  const risks = allRisks ? b.risks : b.risks.slice(0, MAX_RISKS)
  const verdict = d.p_plan >= 0.8 ? 'план дня скорее всего выполним' : d.p_plan >= 0.5 ? 'план дня на грани' : 'план дня под угрозой'

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500"><Sunrise size={14} />{t('Брифинг на 08:00')}</div>
          <h1 className="text-xl font-semibold tracking-tight first-letter:uppercase sm:text-2xl">{longDate(b.date)}</h1>
          {b.kind !== 'work' && <div className="text-sm text-amber-700">{b.kind === 'off' ? 'По календарю выходной — ниже прогноз для рабочего дня.' : 'Сегодня ТО 4 ч.'}</div>}
        </div>
        <button onClick={() => window.print()} title="Распечатать" aria-label="Распечатать" className="rounded-xl bg-white p-2 text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 print:hidden"><Printer size={16} /></button>
      </div>

      {/* 1. Сколько сделаем */}
      <Card className="p-5 print:shadow-none">
        <div className="flex items-center justify-between text-xs text-slate-500">{t('Сегодня сделаем')} <SourceBadge source="forecast" /></div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
          <span className="text-4xl font-semibold tabular-nums">≈ {int(d.mean)}</span>
          <span className="text-slate-500">{t('машин из')} {d.plan}</span>
        </div>
        <div className={`mt-0.5 font-semibold ${tone(d.p_plan)}`}>{t(verdict)} · {t('шанс')} {chance(d.p_plan)}</div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {b.forecast.shifts.map((s) => (
            <span key={s.shift} className="rounded-full bg-slate-50 px-2.5 py-1 tabular-nums text-slate-600 ring-1 ring-slate-100">
              {s.hours}: ≈ {int(s.mean)} из {s.plan} · <b className={tone(s.p_plan)}>{t('шанс')} {chance(s.p_plan)}</b>
            </span>
          ))}
        </div>
        {b.outlook && (
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-violet-50 px-2.5 py-1 text-violet-800 ring-1 ring-violet-100">{t('узкое место')}: <b>{b.outlook.bottleneck_name.toLowerCase()}</b> (в {chance(b.outlook.bottleneck_share)} прогонов)</span>
            <span className={`rounded-full px-2.5 py-1 ring-1 ${b.outlook.p_down_over_limit >= 0.3 ? 'bg-amber-50 text-amber-900 ring-amber-100' : 'bg-slate-50 text-slate-600 ring-slate-100'}`}>
              простой: {b.outlook.down_name.toLowerCase()} ≈ {Math.round(b.outlook.down_min)} мин · шанс &gt; 60 мин — <b>{chance(b.outlook.p_down_over_limit)}</b>
            </span>
          </div>
        )}
        <p className="mt-2 text-[11px] text-slate-400" title={b.note}>{t('Утренний прогноз: внезапные поломки дня в нём не учтены.')}</p>
      </Card>

      {/* 2. Что мешает */}
      <Card className="p-5 print:shadow-none">
        <div className="mb-2 text-sm font-semibold">{t('Что мешает')}</div>
        {b.risks.length === 0 ? <div className="text-sm text-emerald-700">{t('Ничего серьёзного.')}</div> : (
          <ul className="space-y-2.5">
            {risks.map((r) => (
              <li key={r.text} className="flex items-start gap-2.5 text-sm" title={r.detail}>
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[r.level]}`} />
                <span className="min-w-0 flex-1">{r.text}<Go to={r.where} />{r.note && <span className="mt-0.5 block text-xs text-slate-500">{r.note}</span>}</span>
              </li>
            ))}
          </ul>
        )}
        {b.risks.length > MAX_RISKS && (
          <button onClick={() => setAllRisks((x) => !x)} className="mt-2 text-xs font-medium text-slate-500 hover:text-slate-800 print:hidden">
            {allRisks ? 'свернуть' : `ещё ${b.risks.length - MAX_RISKS}`}
          </button>
        )}
      </Card>

      {/* 3. Что сделать */}
      <Card className="p-5 print:shadow-none">
        <div className="mb-2 flex items-center justify-between text-sm font-semibold">{t('Что сделать')} <SourceBadge source="sim" /></div>
        <ol className="space-y-2.5 text-sm">
          {a.names.length > 0 && (
            <li className="flex gap-2"><b className="text-slate-400">1</b><span>
              {a.names.map((n, i) => (i ? low1(n) : n)).join(' и ')} — <b className="text-emerald-700">+{n1(a.delta)} машины за смену</b> (≈ {tenge(a.delta * money.margin)}){a.closes_gap ? ', и план смены выполнен' : ''}.<Go to="actions" />
            </span></li>
          )}
          {b.repair_order.length > 0 && (
            <li className="flex gap-2"><b className="text-slate-400">{a.names.length ? 2 : 1}</b><span>
              Если сломалось сразу несколько участков — чините по порядку: <b>{b.repair_order.map((r) => r.name.toLowerCase()).join(' → ')}</b>. Минута простоя {GEN[b.repair_order[0].station] ?? b.repair_order[0].name.toLowerCase()} стоит {tenge(b.repair_order[0].loss_per_min * money.margin)}.<Go to="station-value" />
            </span></li>
          )}
          {b.containment && (
            <li className="flex gap-2"><b className="text-slate-400">{(a.names.length ? 1 : 0) + (b.repair_order.length ? 1 : 0) + 1}</b><span>
              Брак окраски: осматривайте все кузова после окраски и сразу отправляйте дефектные на ремонт.<Go to="capa" />
            </span></li>
          )}
        </ol>
      </Card>

      {/* 4. Вчера и месяц — одной строкой */}
      <div className="grid gap-3 sm:grid-cols-2">
        {y && (
          <Card className="p-4 print:shadow-none">
            <div className="flex items-center justify-between text-xs text-slate-500">{t('Вчера')} <SourceBadge source={y.has_facts ? 'fact' : 'sim'} /></div>
            <div className="mt-1 text-sm"><b className="tabular-nums">{int(y.fact)}</b> из {y.plan} · {y.pct >= 100 ? <span className="text-emerald-700">план выполнен</span> : <span className="text-amber-700">не хватило {int(y.plan - y.fact)}</span>}<Go to="journal" /></div>
          </Card>
        )}
        <Card className="p-4 print:shadow-none">
          <div className="flex items-center justify-between text-xs text-slate-500">{t('Месяц')} <SourceBadge source="forecast" /></div>
          <div className="mt-1 text-sm">сделано <b className="tabular-nums">{int(m.fact)}</b> из {int(m.plan_to_date)} · к концу ≈ {int(m.mean)}<Go to="journal" /></div>
        </Card>
      </div>
    </div>
  )
}
