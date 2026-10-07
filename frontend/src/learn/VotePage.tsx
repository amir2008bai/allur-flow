import { useEffect, useState } from 'react'
import { api, pct, type Card } from './api'

// Мобильная страница для жюри и мастеров: карточка тревоги → «да» или «нет». Без регистрации.
function getName() { try { return localStorage.getItem('allur-voter') || '' } catch { return '' } }
function setName(v: string) { try { localStorage.setItem('allur-voter', v) } catch { /* без хранилища — ок */ } }

export default function VotePage() {
  const [card, setCard] = useState<Card | null | undefined>(undefined)
  const [name, setNameState] = useState(getName())
  const [done, setDone] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () => api.next().then((r) => setCard(r.card)).catch(() => setCard(null))
  useEffect(() => { load() }, [])

  const answer = async (verdict: 'confirm' | 'reject') => {
    if (!card || busy) return
    setBusy(true)
    try {
      const st = await api.vote(card.id, verdict, name || 'жюри')
      setDone((d) => d + 1)
      setToast(`Спасибо! Модель ${st.version} · точность тревог ${pct(st.now.precision)}`)
      setTimeout(() => setToast(null), 2200)
      await load()
    } finally { setBusy(false) }
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center gap-2.5">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-slate-900 text-sm font-bold text-white">A</div>
        <div className="leading-tight">
          <div className="font-semibold">Allur Flow · обучение</div>
          <div className="text-xs text-slate-500">Ваши ответы учат систему отличать реальные тревоги от ложных</div>
        </div>
      </div>

      <input value={name} onChange={(e) => { setNameState(e.target.value); setName(e.target.value) }} placeholder="Ваше имя (необязательно)"
        className="mt-5 rounded-xl bg-white px-4 py-3 text-sm ring-1 ring-slate-200 outline-none focus:ring-slate-400" maxLength={40} />

      <div className="mt-5 flex-1">
        {card === undefined && <div className="text-sm text-slate-500">Загрузка…</div>}
        {card === null && <div className="rounded-2xl bg-white p-6 text-center ring-1 ring-slate-200"><div className="text-lg font-semibold">Карточки закончились</div><div className="mt-1 text-sm text-slate-500">Спасибо! Вы ответили на {done}.</div></div>}
        {card && (
          <div key={card.id} className="animate-[fadein_.3s_ease] rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>{card.time}</span>
              <span className="rounded-full bg-violet-50 px-2 py-0.5 font-medium uppercase tracking-wide text-violet-700">симуляция</span>
            </div>
            <div className="mt-3 flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" /><h1 className="text-xl font-semibold">{card.title}</h1></div>
            <p className="mt-2 text-base text-slate-600">{card.text}</p>
            <p className="mt-4 text-sm text-slate-500">Это реальная проблема, из-за которой линия потеряет машины в ближайшие 30 минут?</p>
            <div className="mt-2 text-xs text-slate-400">Модель сейчас уверена на {Math.round(card.model_confidence * 100)}% — поэтому спрашивает вас</div>
          </div>
        )}
      </div>

      {card && (
        <div className="sticky bottom-4 mt-6 grid grid-cols-2 gap-3">
          <button disabled={busy} onClick={() => answer('reject')} className="rounded-2xl bg-white py-4 text-base font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 active:scale-[.98] disabled:opacity-50">✕ Ложная</button>
          <button disabled={busy} onClick={() => answer('confirm')} className="rounded-2xl bg-slate-900 py-4 text-base font-semibold text-white shadow-sm active:scale-[.98] disabled:opacity-50">✓ Да, проблема</button>
        </div>
      )}
      <div className="mt-3 text-center text-xs text-slate-400">Отвечено: {done}</div>
      {toast && <div className="fixed inset-x-4 top-4 mx-auto max-w-md rounded-2xl bg-emerald-600 px-4 py-3 text-center text-sm font-medium text-white shadow-lg">{toast}</div>}
      <style>{'@keyframes fadein{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}'}</style>
    </div>
  )
}
