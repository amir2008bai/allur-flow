import { AnimatePresence, motion } from 'motion/react'
import { Suspense, lazy, useEffect, useState } from 'react'
import FactsPage from './FactsPage'
import Copilot from './Copilot'

// вкладки грузятся по требованию: первый экран не тянет ECharts, React Flow и 3D
const TwinPage = lazy(() => import('./TwinPage'))
const LearningPage = lazy(() => import('./learn/LearningPage'))
const StressPage = lazy(() => import('./stress/StressPage'))
const BriefingPage = lazy(() => import('./BriefingPage'))
const ArchPage = lazy(() => import('./arch/ArchPage'))
const VotePage = lazy(() => import('./learn/VotePage'))
const Wait = () => <div className="text-sm text-slate-500">Загрузка…</div>
import { useView } from './twin/store'
import type { Facts, Finding } from './types'
import { NeedServer, OfflineStrip, UpdateBanner } from './NetBanners'
import { useNet } from './net'

const TABS = [
  { id: 'facts', label: 'Факты из ТЗ', short: 'Факты', ready: true },
  { id: 'briefing', label: 'Брифинг', ready: true },
  { id: 'twin', label: 'Двойник', ready: true },
  { id: 'learning', label: 'Обучение', ready: true },
  { id: 'stress', label: 'Испытания', ready: true },
  { id: 'arch', label: 'Архитектура', short: 'Схема', ready: true },
]

export default function App() {
  if (window.location.pathname.startsWith('/vote')) return <><Suspense fallback={null}><VotePage /></Suspense><UpdateBanner /></>
  return <><MainApp /><UpdateBanner /></>
}

function MainApp() {
  const [data, setData] = useState<{ facts: Facts; findings: Finding[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const tab = useView((v) => v.tab)
  const setTab = useView((v) => v.setTab)

  const server = useNet((s) => s.server)
  const loaded = data != null
  useEffect(() => {
    if (loaded) return
    const j = (r: Response) => { if (!r.ok) throw new Error(String(r.status)); return r.json() }
    Promise.all([fetch('/api/facts').then(j), fetch('/api/findings').then(j)])
      .then(([facts, findings]) => { setData({ facts, findings }); setError(null) })
      .catch(() => setError('offline'))
  }, [loaded, server])   // связь появилась — пробуем ещё раз

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 print:hidden border-b border-black/5 bg-white/70 backdrop-blur-2xl backdrop-saturate-150">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-3 py-2 sm:gap-6 sm:px-6 sm:py-2.5">
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
                className={`relative shrink-0 whitespace-nowrap rounded-full px-2.5 py-1.5 text-[13px] font-medium sm:px-4 ${tab === t.id ? 'text-slate-900' : 'text-slate-500 hover:text-slate-800'}`}>
                {tab === t.id && <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)]" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                <span className="relative">{t.short ? <><span className="sm:hidden">{t.short}</span><span className="hidden sm:inline">{t.label}</span></> : t.label}</span>
              </button>
            ))}
          </nav>
          <div className="hidden w-[120px] shrink-0 lg:block" />
        </div>
        <OfflineStrip />
      </header>
      <main className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-6">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}>
            <Suspense fallback={<Wait />}>
              {tab === 'briefing' && (server === false ? <NeedServer what="Брифинг собирается на сервере из прогноза, журнала и контрольной карты." /> : <BriefingPage />)}
              {tab === 'twin' && <TwinPage />}
              {tab === 'learning' && <LearningPage />}
              {tab === 'stress' && <StressPage />}
              {tab === 'arch' && <ArchPage />}
            </Suspense>
            {tab === 'facts' && error && !data && <NeedServer what="Факты из ТЗ считаются на сервере. Двойник и Испытания работают и без него — на записанных прогонах." />}
            {tab === 'facts' && !data && !error && <div className="text-sm text-slate-500">Загрузка данных…</div>}
            {tab === 'facts' && data && <FactsPage facts={data.facts} findings={data.findings} />}
          </motion.div>
        </AnimatePresence>
      </main>
      <Copilot />
    </div>
  )
}
