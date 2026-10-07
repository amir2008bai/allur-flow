import { createContext, useContext, useRef, type ReactNode } from 'react'
import { useFrame, type RootState } from '@react-three/fiber'
import { animationRate } from './motion'
import { useView } from './store'
import { useReducedMotion } from './motionPreference'

export interface SceneTime { time: number; dt: number; frozen: boolean; reduced: boolean }
const MotionContext = createContext<{ current: SceneTime } | null>(null)

/** Один визуальный таймер на сцену. Пауза немедленная, скорость не равна ускорению смены. */
export function SceneMotion({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion()
  const motion = useRef<SceneTime>({ time: 0, dt: 0, frozen: true, reduced: reduce })
  useFrame((_, delta) => {
    const { playing, speed } = useView.getState()
    const m = motion.current
    m.reduced = reduce
    m.frozen = !playing || reduce
    m.dt = m.frozen ? 0 : Math.min(delta, 0.05) * animationRate(speed)
    m.time += m.dt
  }, -2)
  return <MotionContext.Provider value={motion}>{children}</MotionContext.Provider>
}

export function useMotionFrame(callback: (motion: SceneTime, state: RootState) => void) {
  const motion = useContext(MotionContext)
  if (!motion) throw new Error('Animated equipment must be inside SceneMotion')
  useFrame((state) => callback(motion.current, state))
}
