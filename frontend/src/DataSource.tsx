import { AlertTriangle, CheckCircle2, Database, FileUp, RotateCcw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Card } from './ui'
import { NEED_SERVER, fromCache, useNet } from './net'

interface Status { file: string; is_test: boolean; rows: Record<string, number>; date_from: string | null; date_to: string | null; warnings: string[]; calibration: { target_per_shift: number; model_per_shift: number } | null }
interface Preview { file: string; rows: Record<string, number>; date_from: string | null; date_to: string | null; areas: string[]; warnings: string[]; top_findings: { title: string; key: string | null; severity: string }[] }

const d = (s: string | null) => (s ? s.split('-').reverse().join('.') : '—')
const AREA_RU: Record<string, string> = { welding: 'сварка', paint: 'окраска', assembly: 'сборка' }

/** Какие данные сейчас в системе + загрузка реальных (Word / Excel / CSV) с предпросмотром. */
export default function DataSource() {
  const [st, setSt] = useState<Status | null>(null)
  const [pv, setPv] = useState<{ p: Preview; file: File } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const server = useNet((s) => s.server)
  const offline = server === false
  useEffect(() => { fetch('/api/data/status').then((r) => { if (!r.ok) throw new Error(); if (fromCache(r)) useNet.getState().setServer(false); return r.json() }).then(setSt).catch(() => {}) }, [server])

  const pick = async (file: File) => {
    setErr(null); setBusy(true)
    try {
      const fd = new FormData(); fd.append('file', file)
      const r = await fetch('/api/data/preview', { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j.detail ?? 'Не удалось прочитать файл')
      setPv({ p: j, file })
    } catch (e) { setErr(e instanceof TypeError ? NEED_SERVER : (e as Error).message) } finally { setBusy(false); if (input.current) input.current.value = '' }
  }
  const apply = async () => {
    if (!pv) return
    setBusy(true)
    const fd = new FormData(); fd.append('file', pv.file)
    try {
      const r = await fetch('/api/data/activate', { method: 'POST', body: fd })
      if (r.ok) window.location.reload()
      else { setErr((await r.json()).detail); setBusy(false) }
    } catch { setErr(NEED_SERVER); setBusy(false) }
  }
  const reset = async () => { setBusy(true); await fetch('/api/data/reset', { method: 'POST' }); window.location.reload() }

  if (!st) return offline ? <Card className="p-4 text-sm text-slate-500"><b className="font-semibold text-slate-700">Загрузка данных завода</b> · {NEED_SERVER.toLowerCase()}</Card> : null
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`grid h-9 w-9 place-items-center rounded-xl ${st.is_test ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}><Database size={18} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{st.is_test ? 'Тестовые данные из ТЗ' : 'Реальные данные завода'}</div>
          <div className="truncate text-xs text-slate-500">{st.file} · {d(st.date_from)} – {d(st.date_to)} · {st.rows.lines} строк работы линий, {st.rows.quality} — качества, {st.rows.downtime} простоев{st.calibration ? ` · двойник подогнан: ${st.calibration.model_per_shift} машин/смену при факте ${st.calibration.target_per_shift}` : ''}</div>
        </div>
        {!st.is_test && <button disabled={busy || offline} onClick={reset} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-800"><RotateCcw size={14} />Вернуть тестовые</button>}
        <button disabled={busy || offline} title={offline ? NEED_SERVER : undefined} onClick={() => input.current?.click()} className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
          <FileUp size={15} />{offline ? NEED_SERVER : busy && !pv ? 'Читаю…' : 'Загрузить данные'}
        </button>
        <input ref={input} type="file" accept=".xlsx,.xlsm,.docx,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
      </div>
      {err && <div className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{err}</div>}

      {pv && (
        <div className="mt-4 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Предпросмотр: {pv.p.file}</div>
              <div className="text-xs text-slate-500">{d(pv.p.date_from)} – {d(pv.p.date_to)} · участки: {pv.p.areas.map((a) => AREA_RU[a] ?? a).join(', ')}</div>
            </div>
            <button onClick={() => setPv(null)} className="rounded-full p-1 text-slate-400 hover:bg-white" aria-label="Отмена"><X size={16} /></button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[['Работа линий', pv.p.rows.lines], ['Качество', pv.p.rows.quality], ['Простои', pv.p.rows.downtime], ['План по моделям', pv.p.rows.model_plan]].map(([l, v]) => (
              <div key={l} className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-100"><div className="text-[11px] text-slate-500">{l}</div><div className="text-lg font-semibold">{v} <span className="text-xs font-normal text-slate-400">строк</span></div></div>
            ))}
          </div>
          {pv.p.top_findings.length > 0 && (
            <div className="mt-3 text-sm"><span className="text-xs text-slate-500">Что система уже видит: </span>{pv.p.top_findings.map((f) => `${f.title}${f.key ? ` (${f.key})` : ''}`).join(' · ')}</div>
          )}
          {pv.p.warnings.length > 0 && (
            <details className="mt-2 text-xs text-amber-700"><summary className="cursor-pointer">Замечания при чтении: {pv.p.warnings.length}</summary><ul className="mt-1 list-disc pl-5">{pv.p.warnings.slice(0, 10).map((w, i) => <li key={i}>{w}</li>)}</ul></details>
          )}
          <div className="mt-4 flex items-center gap-3">
            <button disabled={busy || offline} onClick={apply} className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"><CheckCircle2 size={16} />{busy ? 'Применяю и калибрую двойник…' : 'Применить'}</button>
            <span className="text-xs text-slate-500">Двойник перекалибруется под эти данные: брак и темп участков.</span>
          </div>
        </div>
      )}
    </Card>
  )
}
