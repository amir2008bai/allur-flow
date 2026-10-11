import { create } from 'zustand'
import type { ZoneId } from './layout'
import { todayISO } from '../dates'

/** Узкий экран (телефон): по умолчанию лёгкий вид «План», а не 3D. */
export const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches

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
  cameraZoomStep: number
  zoomCamera: (step: -1 | 1) => void
  setTouring: (t: boolean) => void
  scenario: string
  setScenario: (s: string) => void
  tab: string
  setTab: (t: string) => void
  section: TwinSection
  setSection: (s: TwinSection) => void
  date: string
  setDate: (d: string) => void
  question: string | null
  incidentText: string | null
  stressInfo: string | null
  setScreen: (p: { incidentText?: string | null; stressInfo?: string | null }) => void
  ask: (q: string) => void
  clearQuestion: () => void
}

/** Разделы вкладки «Двойник» под 3D: что сейчас / решения / качество / история. */
export type TwinSection = 'now' | 'decide' | 'quality' | 'history'
/** В каком разделе лежит блок (для ссылок из брифинга и кнопок). */
export const SECTION_OF: Record<string, TwinSection> = {
  kpi: 'now', workorders: 'now', events: 'now',
  'shift-builder': 'decide', actions: 'decide', effect: 'decide', 'station-value': 'decide',
  'paint-spc': 'quality', capa: 'quality', cascade: 'quality',
  journal: 'history',
}

export const useView = create<ViewState>((set) => ({
  selected: null,
  t: 0,
  playing: false,
  speed: 20,
  view: isPhone() ? 'plan' : '3d',
  touring: false,
  cameraZoomStep: 0,
  zoomCamera: (step) => set((state) => ({ cameraZoomStep: state.cameraZoomStep + step, touring: false })),
  scenario: 'base',
  setScenario: (scenario) => set({ scenario }),
  tab: 'facts',
  section: 'now',
  setSection: (section) => set({ section }),
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
