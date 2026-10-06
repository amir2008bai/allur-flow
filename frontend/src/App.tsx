import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import FactsPage from './FactsPage'
import TwinPage from './TwinPage'
import LearningPage from './learn/LearningPage'
import VotePage from './learn/VotePage'
import Copilot from './Copilot'
import StressPage from './stress/StressPage'
import { useView } from './twin/store'
import type { Facts, Finding } from './types'

const TABS = [
  { id: 'facts', label: 'Факты из ТЗ', ready: true },
  { id: 'twin', label: 'Двойник', ready: true },
  { id: 'learning', label: 'Обучение', ready: true },
  { id: 'stress', label: 'Испытания', ready: true },
]

export default function App() {
  if (window.location.pathname.startsWith('/vote')) return <VotePage />
  return <MainApp />
}

function MainApp() {
  const [data, setData] = useState<{ facts: Facts; findings: Finding[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const tab = useView((v) => v.tab)
  const setTab = useView((v) => v.setTab)

  useEffect(() => {
    Promise.all([fetch('/api/facts').then((r) => r.json()), fetch('/api/findings').then((r) => r.json())])
      .then(([facts, findings]) => setData({ facts, findings }))
      .catch(() => setError('Сервер не отвечает. Запустите backend (см. README).'))
  }, [])

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-black/5 bg-white/70 backdrop-blur-2xl backdrop-saturate-150">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-2.5 sm:px-6">
          <div className="flex shrink-0 items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-[10px] bg-gradient-to-br from-slate-800 to-slate-950 text-sm font-bold text-white shadow-sm">A</div>
            <div className="hidden leading-tight sm:block">
              <div className="text-[15px] font-semibold tracking-tight">Allur Flow</div>
              <div className="text-[11px] text-slate-500">Цифровой двойник · Костанай</div>
            </div>
          </div>
          {/* сегментированный переключатель в стиле Apple: «пилюля» плавно переезжает */}
          <nav className="mx-auto flex gap-0.5 overflow-x-auto rounded-full bg-slate-900/[0.05] p-1 [scrollbar-width:none]">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`relative whitespace-nowrap rounded-full px-4 py-1.5 text-[13px] font-medium ${tab === t.id ? 'text-slate-900' : 'text-slate-500 hover:text-slate-800'}`}>
                {tab === t.id && <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)]" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                <span className="relative">{t.label}</span>
              </button>
            ))}
          </nav>
          <div className="hidden w-[120px] shrink-0 lg:block" />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}>
            {tab === 'twin' && <TwinPage />}
            {tab === 'learning' && <LearningPage />}
            {tab === 'stress' && <StressPage />}
            {tab === 'facts' && error && <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</div>}
            {tab === 'facts' && !data && !error && <div className="text-sm text-slate-500">Загрузка данных…</div>}
            {tab === 'facts' && data && <FactsPage facts={data.facts} findings={data.findings} />}
          </motion.div>
        </AnimatePresence>
      </main>
      <Copilot />
    </div>
  )
}
