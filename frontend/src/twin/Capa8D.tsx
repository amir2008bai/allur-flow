import { CheckCircle2, ClipboardCheck, Clock, Plus, X, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { todayISO } from '../dates'
import { Card, SourceBadge } from '../ui'

interface Cause { m: string; hypothesis: string; check: string; status: string }
interface Preset { id: string; cause: string; text: string }
interface Draft { problem: string; containment: string; causes: Cause[]; presets: Preset[]; min_days: number; special_days: { day: string; p: number; source?: 'fact' | 'sim' }[] }
interface Side { days: number; n: number; defects: number; p: number | null; fact_days?: number; excluded_days?: string[] }
interface Check { verdict: 'wait' | 'confirmed' | 'not_confirmed'; title: string; text: string; before: Side; after: Side; p_value?: number; demo?: boolean; note?: string }
interface Item { id: number; start_day: string; action: string; cause: string; owner: string; check: Check }

const pc = (x: number | null) => (x == null ? '—' : `${(100 * x).toFixed(1).replace('.', ',')}%`)
const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-semibold text-white">{n}</span>
      <div className="min-w-0 flex-1 pb-4">
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-1 text-sm text-slate-600">{children}</div>
      </div>
    </div>
  )
}

const VERDICT = {
  wait: { cls: 'bg-slate-50 text-slate-700 ring-slate-200', Icon: Clock },
  confirmed: { cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200', Icon: CheckCircle2 },
  not_confirmed: { cls: 'bg-amber-50 text-amber-900 ring-amber-200', Icon: XCircle },
}

/** Разбор брака окраски по шагам (8D) + автоматическая проверка, помогло ли действие. */
export default function Capa8D() {
  const today = todayISO()
  const [data, setData] = useState<{ draft: Draft; actions: Item[] } | null>(null)
  const [preset, setPreset] = useState('filters')
  const [text, setText] = useState('')
  const [start, setStart] = useState(today)
  const [owner, setOwner] = useState('')
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => { fetch(`/api/capa?today=${today}`).then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => {}) }, [today, tick])
  useEffect(() => { if (preset === 'own') { setText(''); return } const p = data?.draft.presets.find((x) => x.id === preset); if (p) setText(p.text) }, [preset, data?.draft.presets])   // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <Card className="p-5 text-sm text-slate-500">Готовлю разбор брака…</Card>
  const d = data.draft
  const cause = d.presets.find((x) => x.id === preset)?.cause ?? ''

  const save = async () => {
    if (text.trim().length < 3) return
    setBusy(true)
    await fetch('/api/capa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start_day: start, action: text, cause, owner, today }) }).catch(() => {})
    setBusy(false); setTick((x) => x + 1)
  }
  const remove = async (id: number) => { await fetch(`/api/capa/${id}`, { method: 'DELETE' }).catch(() => {}); setTick((x) => x + 1) }

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-700"><ClipboardCheck size={18} /></span>
          <div>
            <h2 className="text-lg font-semibold leading-tight">Разбор брака окраски по шагам</h2>
            <p className="text-sm text-slate-500">Метод 8D из автопрома: проблема → сдерживание → причины → действие → проверка. Проверку эффекта двойник делает сам.</p>
          </div>
        </div>
        <SourceBadge source="calc" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <Step n={1} title="Проблема">{d.problem}{d.special_days.length > 0 && <> Особые причины: {d.special_days.map((s) => `${dm(s.day)} (${pc(s.p)}${s.source === 'sim' ? ', день двойника' : ', данные завода'})`).join(', ')}.</>}</Step>
          <Step n={2} title="Сдерживание — сразу">{d.containment}</Step>
          <Step n={3} title="Причины — гипотезы и чем проверить">
            <ul className="mt-1 space-y-1.5">
              {d.causes.map((c) => (
                <li key={c.m} className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                  <div className="text-xs"><b className="text-slate-800">{c.m}:</b> {c.hypothesis}</div>
                  <div className="text-[11px] text-slate-500">проверить: {c.check} · <span className="text-slate-400">{c.status}</span></div>
                </li>
              ))}
            </ul>
          </Step>
        </div>

        <div>
          <Step n={4} title="Действие — что сделали">
            <div className="space-y-2">
              <select value={preset} onChange={(e) => setPreset(e.target.value)} className="w-full rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-slate-200">
                {d.presets.map((p) => <option key={p.id} value={p.id}>{p.cause}: {p.text}</option>)}
                <option value="own">Своё действие…</option>
              </select>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={300} placeholder="Что именно сделали"
                className="w-full rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-slate-200" />
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-slate-500">с какого дня
                  <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="rounded-lg bg-white px-2 py-1.5 text-sm text-slate-800 ring-1 ring-slate-200" /></label>
                <input value={owner} onChange={(e) => setOwner(e.target.value)} maxLength={80} placeholder="ответственный"
                  className="min-w-0 flex-1 rounded-lg bg-white px-2 py-1.5 text-sm ring-1 ring-slate-200" />
                <button onClick={save} disabled={busy || text.trim().length < 3}
                  className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700 active:scale-[.98] disabled:opacity-40"><Plus size={14} />Записать</button>
              </div>
            </div>
          </Step>
          <Step n={5} title="Проверка эффекта — делает двойник">
            {data.actions.length === 0 ? <span className="text-slate-400">Запишите действие — двойник сравнит брак до и после через {d.min_days} рабочих дней.</span> : (
              <ul className="space-y-2">
                {data.actions.map((a) => {
                  const v = VERDICT[a.check.verdict]
                  return (
                    <li key={a.id} className={`rounded-xl px-3 py-2.5 ring-1 ${v.cls}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-xs text-slate-600">с {dm(a.start_day)}{a.cause && ` · ${a.cause}`}{a.owner && ` · ${a.owner}`}<div className="text-sm font-medium text-slate-900">{a.action}</div></div>
                        <button onClick={() => remove(a.id)} className="rounded-lg p-1 text-slate-400 hover:bg-white/70 hover:text-slate-700" aria-label="Удалить действие"><X size={14} /></button>
                      </div>
                      <div className="mt-1.5 flex items-start gap-1.5 text-sm font-semibold"><v.Icon size={15} className="mt-0.5 shrink-0" />{a.check.title}</div>
                      <div className="mt-0.5 text-xs opacity-90">{a.check.text}</div>
                      <div className="mt-1 text-[11px] tabular-nums text-slate-500">
                        до: {pc(a.check.before.p)} за {a.check.before.days} раб. дн.{(a.check.before.excluded_days?.length ?? 0) > 0 && ` (без дней с особой причиной: ${a.check.before.excluded_days!.map(dm).join(', ')})`}
                        {' · '}после: {pc(a.check.after.p)} за {a.check.after.days} раб. дн.{a.check.p_value != null && ` · вероятность случайности ${pc(a.check.p_value)}`}
                      </div>
                      {a.check.note && <div className="mt-1 text-[11px] text-slate-500">{a.check.demo && <b className="mr-1 uppercase tracking-wide">демо ·</b>}{a.check.note}</div>}
                    </li>
                  )
                })}
              </ul>
            )}
          </Step>
        </div>
      </div>
      <p className="text-[11px] text-slate-400">
        «Подтверждён» — только если брак после действия ниже и разница не объясняется случайным разбросом (вероятность случайности меньше 1%: проверка пересчитывается каждый день, поэтому порог строгий).
        Дни с особой причиной не входят в базу «до» — иначе любое действие после аномального дня «подтвердилось» бы само. Минимум {d.min_days} рабочих дней после действия.
      </p>
    </Card>
  )
}
