import { useEffect, useState } from 'react'

/** Лёгкий DOM-хук: не загружает three/R3F при открытии Плана на телефоне. */
export function useReducedMotion() {
  const [reduce, setReduce] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => setReduce(query.matches)
    query.addEventListener('change', change)
    change()
    return () => query.removeEventListener('change', change)
  }, [])
  return reduce
}
