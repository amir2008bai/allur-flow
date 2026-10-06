import { Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useView } from './twin/store'
import type { ZoneId } from './twin/layout'

// Копилот: вопрос → функции двойника → короткий ответ с источниками; может сам показать участок в 3D.
interface Reply { answer: string; model: string; mode: 'llm' | 'offline'; sources: string[]; unverified: string[]; actions: { type: string; zone: ZoneId }[]; fallback_reason?: string }
interface Msg { role: 'user' | 'assistant'; text: string; meta?: Reply }

const CHIPS = ['Во что обходится брак окраски?', 'Где узкое место?', 'Что сделать, чтобы выпустить больше?', 'Почему OEE не считается?']

/** **жирный** → <b>, остальная разметка убирается. */
function Rich({ text }: { text: string }) {
  const clean = text.replace(/^#+\s*/gm, '').replace(/^\s*[-*]\s+/gm, '• ')
  return <>{clean.split(/(\*\*[^*]+\*\*)/g).map((p, i) => p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>)}</>
}

export default function Copilot() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scenario = useView((v) => v.scenario)
  const question = useView((v) => v.question)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])
  useEffect(() => {
    if (!question) return
    setOpen(true)
    useView.getState().clearQuestion()
    send(question, false)
  }, [question]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (text: string, offline: boolean) => {
    if (!text.trim() || busy) return
    const history = msgs.slice(-6).map((m) => ({ role: m.role, content: m.text }))
    setMsgs((m) => [...m, { role: 'user', text }])
    setInput('')
    setBusy(true)
    try {
      const r: Reply = await fetch('/api/copilot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, history, offline, scenario }) }).then((x) => x.json())
      setMsgs((m) => [...m, { role: 'assistant', text: r.answer, meta: r }])
      const focus = r.actions?.find((a) => a.type === 'focus')
      if (focus) {   // ответ двигает сцену: переходим в 3D и подлетаем к участку
        const v = useView.getState()
        v.setTab('twin'); v.setView('3d'); v.select(focus.zone)
      }
    } catch {
      setMsgs((m) => [...m, { role: 'assistant', text: 'Сервер не отвечает.' }])
    } finally { setBusy(false) }
  }

  if (!open) return (
    <button onClick={() => setOpen(true)} className="fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-xl hover:bg-slate-700">
      <Sparkles size={17} /> Спросить двойник
    </button>
  )

  return (
    <div className="fixed bottom-5 right-5 z-30 flex h-[min(620px,80vh)] w-[min(400px,calc(100vw_-_2.5rem))] flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-200">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <div>
          <div className="flex items-center gap-1.5 font-semibold"><Sparkles size={16} className="text-violet-600" />Помощник смены</div>
          <div className="text-[11px] text-slate-500">Отвечает только по данным двойника</div>
        </div>
        <button onClick={() => setOpen(false)} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Закрыть">✕</button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {msgs.length === 0 && <div className="text-sm text-slate-500">Спросите о линии или нажмите вопрос ниже.</div>}
        {msgs.map((m, i) => m.role === 'user'
          ? <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-slate-900 px-3.5 py-2 text-sm text-white">{m.text}</div>
          : (
            <div key={i} className="max-w-[92%]">
              <div className="rounded-2xl rounded-bl-md bg-slate-100 px-3.5 py-2.5 text-sm leading-relaxed text-slate-800"><Rich text={m.text} /></div>
              {m.meta && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {m.meta.sources.map((s) => <span key={s} className="rounded-full bg-white px-2 py-0.5 text-[10px] text-slate-500 ring-1 ring-slate-200">{s}</span>)}
                  {m.meta.unverified.length > 0
                    ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700 ring-1 ring-amber-200">не проверено: {m.meta.unverified.join(', ')}</span>
                    : <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700 ring-1 ring-emerald-200">✓ числа проверены</span>}
                  <span className="rounded-full px-2 py-0.5 text-[10px] text-slate-400">{m.meta.mode === 'llm' ? 'ИИ' : 'быстрый ответ'}</span>
                </div>
              )}
            </div>
          ))}
        {busy && <div className="flex gap-1 px-2 py-2">{[0, 1, 2].map((i) => <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-slate-300" style={{ animationDelay: `${i * 0.15}s` }} />)}</div>}
        <div ref={end} />
      </div>

      <div className="border-t border-slate-100 p-3">
        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
          {CHIPS.map((c) => <button key={c} disabled={busy} onClick={() => send(c, true)} className="whitespace-nowrap rounded-full bg-slate-50 px-3 py-1.5 text-xs text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100 disabled:opacity-50">{c}</button>)}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); send(input, false) }} className="flex gap-2">
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Свой вопрос — ответит ИИ" maxLength={500}
            className="min-w-0 flex-1 rounded-xl bg-slate-50 px-3 py-2.5 text-sm ring-1 ring-slate-200 outline-none focus:ring-slate-400" />
          <button disabled={busy || !input.trim()} className="rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-40">→</button>
        </form>
      </div>
    </div>
  )
}
