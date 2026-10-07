// Связь с сервером и обновления приложения (PWA). Одно место, откуда весь интерфейс узнаёт «есть ли сервер».
import { create } from 'zustand'

interface NetState {
  /** null — ещё не проверяли; false — сервер не отвечает (офлайн-режим) */
  server: boolean | null
  /** новая версия скачана и ждёт нажатия «Обновить» */
  update: ServiceWorker | null
  setServer: (ok: boolean) => void
}

export const useNet = create<NetState>((set) => ({
  server: null,
  update: null,
  setServer: (server) => set((s) => (s.server === server ? s : { server })),
}))

/** Пинг /api/health с коротким таймаутом. Сервис-воркер этот адрес не кеширует — ответ всегда честный. */
export async function checkServer(): Promise<boolean> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 2500)
  let ok = false
  try { ok = (await fetch('/api/health', { signal: ctrl.signal, cache: 'no-store' })).ok } catch { ok = false } finally { clearTimeout(t) }
  useNet.getState().setServer(ok)
  return ok
}

/** Ответ пришёл из кеша сервис-воркера, а не от живого сервера. */
export const fromCache = (r: Response) => r.headers.get('X-Allur-Offline') === '1'

export const NEED_SERVER = 'Нужно подключение к серверу'

let started = false
export function startNet() {
  if (started) return
  started = true
  checkServer()
  setInterval(checkServer, 15000)
  window.addEventListener('online', () => checkServer())
  window.addEventListener('offline', () => useNet.getState().setServer(false))
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkServer() })
  registerSW()
}

function registerSW() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js')
      const offer = (w: ServiceWorker | null) => { if (w && navigator.serviceWorker.controller) useNet.setState({ update: w }) }
      offer(reg.waiting)
      reg.addEventListener('updatefound', () => {
        const w = reg.installing
        w?.addEventListener('statechange', () => { if (w.state === 'installed') offer(w) })
      })
      setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000)
    } catch { /* без сервис-воркера приложение просто работает онлайн */ }
  })
}

/** Пользователь нажал «Обновить»: включаем новую версию и перезагружаем один раз. */
export function applyUpdate() {
  const w = useNet.getState().update
  if (!w) return
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true })
  w.postMessage({ type: 'SKIP_WAITING' })
}
