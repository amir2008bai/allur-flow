import { CloudOff, RefreshCw, X } from 'lucide-react'
import { useState } from 'react'
import { NEED_SERVER, applyUpdate, useNet } from './net'
import { Card } from './ui'

/** Плашка «Доступна новая версия». Страницу сами не перезагружаем — может идти демо. */
export function UpdateBanner() {
  const update = useNet((s) => s.update)
  const [hidden, setHidden] = useState(false)
  if (!update || hidden) return null
  return (
    <div className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md sm:bottom-6 items-center gap-2 rounded-2xl bg-white/95 py-1.5 pl-4 pr-1.5 text-sm shadow-lg ring-1 ring-slate-200 backdrop-blur [animation:updin_.4s_ease]" role="status">
      <span className="min-w-0 flex-1 font-medium">Доступна новая версия</span>
      <button onClick={applyUpdate} className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"><RefreshCw size={14} />Обновить</button>
      <button onClick={() => setHidden(true)} className="grid place-items-center rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Позже"><X size={16} /></button>
      <style>{'@keyframes updin{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}'}</style>
    </div>
  )
}

/** Тонкая полоса под шапкой, когда сервер не отвечает. */
export function OfflineStrip() {
  const server = useNet((s) => s.server)
  if (server !== false) return null
  return (
    <div className="border-b border-amber-200/60 bg-amber-50/90 text-amber-800">
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-1.5 text-xs sm:px-6">
        <CloudOff size={14} className="shrink-0" />
        <span><b className="font-semibold">Офлайн-режим</b> — нет связи с сервером. Двойник и Испытания показывают записанные прогоны.</span>
      </div>
    </div>
  )
}

/** Спокойное сообщение там, где без сервера нельзя. */
export function NeedServer({ what, className = '' }: { what?: string; className?: string }) {
  return (
    <Card className={`flex items-start gap-3 p-5 ${className}`}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500"><CloudOff size={18} /></span>
      <div>
        <div className="text-sm font-semibold">{NEED_SERVER}</div>
        {what && <div className="mt-0.5 text-sm text-slate-500">{what}</div>}
      </div>
    </Card>
  )
}
