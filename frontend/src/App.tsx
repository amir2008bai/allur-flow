import { useEffect, useState } from 'react'
import FactsPage from './FactsPage'
import type { Facts, Finding } from './types'

const TABS = [
  { id: 'facts', label: 'Факты из ТЗ', ready: true },
  { id: 'twin', label: 'Двойник', ready: false },
  { id: 'forecast', label: 'Прогноз', ready: false },
  { id: 'learning', label: 'Обучение', ready: false },
]

export default function App() {
  const [data, setData] = useState<{ facts: Facts; findings: Finding[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([fetch('/api/facts').then((r) => r.json()), fetch('/api/findings').then((r) => r.json())])
      .then(([facts, findings]) => setData({ facts, findings }))
      .catch(() => setError('Сервер не отвечает. Запустите backend (см. README).'))
  }, [])

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-slate-900 text-sm font-bold text-white">A</div>
            <div className="leading-tight">
              <div className="font-semibold">Allur Flow</div>
              <div className="text-[11px] text-slate-500">Цифровой двойник · Костанай</div>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button key={t.id} disabled={!t.ready}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${t.ready ? 'bg-slate-100 font-medium text-slate-900' : 'cursor-not-allowed text-slate-400'}`}>
                {t.label}{!t.ready && <span className="ml-1 text-[10px]">скоро</span>}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {error && <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        {!data && !error && <div className="text-sm text-slate-500">Загрузка данных…</div>}
        {data && <FactsPage facts={data.facts} findings={data.findings} />}
      </main>
    </div>
  )
}
