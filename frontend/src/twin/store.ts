import { create } from 'zustand'
import type { ZoneId } from './layout'
import { todayISO } from '../dates'

// Только состояние вида: что выбрано, какой момент, какой вид. Сами KPI приходят с сервера.
interface ViewState {
  selected: ZoneId | null
  t: number
  playing: boolean
  speed: number // симулированных минут в секунду
  view: '3d' | 'plan' | 'flow'
  select: (z: ZoneId | null) => void
  setT: (t: number) => void
  setPlaying: (p: boolean) => void
  setSpeed: (s: number) => void
  setView: (v: '3d' | 'plan' | 'flow') => void
  touring: boolean
  setTouring: (t: boolean) => void
  scenario: string
  setScenario: (s: string) => void
  tab: string
  setTab: (t: string) => void
  date: string
  setDate: (d: string) => void
  question: string | null
  incidentText: string | null
  stressInfo: string | null
  setScreen: (p: { incidentText?: string | null; stressInfo?: string | null }) => void
  ask: (q: string) => void
  clearQuestion: () => void
}

export const useView = create<ViewState>((set) => ({
  selected: null,
  t: 0,
  playing: false,
  speed: 20,
  view: '3d',
  touring: false,
  scenario: 'base',
  setScenario: (scenario) => set({ scenario }),
  tab: 'facts',
  date: todayISO(),
  question: null,
  incidentText: null,
  stressInfo: null,
  setScreen: (p) => set(p),
  ask: (question) => set({ question }),
  clearQuestion: () => set({ question: null }),
  setDate: (date) => set({ date }),
  setTab: (tab) => set({ tab }),
  setTouring: (touring) => set({ touring }),
  select: (selected) => set({ selected }),
  setT: (t) => set({ t }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  setView: (view) => set({ view }),
}))
