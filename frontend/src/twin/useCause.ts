import { useEffect, useRef, useState } from 'react'
import type { SimRun } from '../source'
import { incidents, type Incident } from './cause'
import { useView } from './store'

const HOLD_MS = 3000  // инцидент держится на экране минимум 3 с реального времени

/** Текущий устойчивый инцидент с «залипанием»: не мелькает при быстрой перемотке. */
export function useCause(run: SimRun): Incident | null {
  const t = useView((s) => s.t)
  const [, force] = useState(0)
  const shown = useRef<{ inc: Incident | null; at: number }>({ inc: null, at: 0 })
  const list = incidents(run)
  const now = performance.now()
  const active = list.find((i) => t >= i.start && t <= i.end) ?? null
  const cur = shown.current
  if (active && active !== cur.inc && (cur.inc === null || now - cur.at > HOLD_MS || t < cur.inc.start)) {
    shown.current = { inc: active, at: now }
  } else if (!active && cur.inc && (now - cur.at > HOLD_MS || t < cur.inc.start)) {
    shown.current = { inc: null, at: now }
  }
  // если время на паузе — через HOLD_MS всё равно обновить, чтобы старый инцидент ушёл
  useEffect(() => {
    const id = setTimeout(() => force((x) => x + 1), HOLD_MS + 50)
    return () => clearTimeout(id)
  }, [shown.current.inc])
  useEffect(() => { shown.current = { inc: null, at: 0 } }, [run])
  return shown.current.inc
}
