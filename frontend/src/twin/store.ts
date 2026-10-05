import { create } from 'zustand'
import type { ZoneId } from './layout'

// Только состояние вида: что выбрано, какой момент, какой вид. Сами KPI приходят с сервера.
interface ViewState {
  selected: ZoneId | null
  t: number
  playing: boolean
  speed: number // симулированных минут в секунду
  view: '3d' | '2d'
  select: (z: ZoneId | null) => void
  setT: (t: number) => void
  setPlaying: (p: boolean) => void
  setSpeed: (s: number) => void
  setView: (v: '3d' | '2d') => void
}

export const useView = create<ViewState>((set) => ({
  selected: null,
  t: 0,
  playing: false,
  speed: 20,
  view: '3d',
  select: (selected) => set({ selected }),
  setT: (t) => set({ t }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  setView: (view) => set({ view }),
}))
