/* Service worker Allur Flow. Шаблон: при сборке `pwa/sw-plugin.js` подставляет версию и список файлов
 * и кладёт готовый файл в dist/sw.js. Пишем сами, без Workbox — см. PROGRESS.md (5.9b).
 *
 * Правила:
 * - оболочка приложения и replay-записи (bundles/*.json) — из кеша (precache), обновляются только новой версией;
 * - GET /api: сеть; ответы «справочников» (факты, выводы, мета) кешируются и отдаются без сети с пометкой X-Allur-Offline;
 * - POST и поток /api/sim/stream — никогда не трогаем и не кешируем;
 * - новая версия ждёт, пока пользователь не нажмёт «Обновить» (SKIP_WAITING), страницу сами не перезагружаем.
 */
const VERSION = '__VERSION__'
const PRECACHE = __PRECACHE__
const SHELL = `allur-shell-${VERSION}`
const API = 'allur-api-v1'
const API_TIMEOUT_MS = 4000

// GET-ответы, которые можно показать без сети (они меняются редко и не содержат расчётов «на сейчас»)
const API_CACHEABLE = ['/api/facts', '/api/findings', '/api/sim/meta', '/api/sim/options', '/api/stress/scenarios', '/api/data/status']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))))
  // без skipWaiting: новая версия ждёт решения пользователя
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('allur-shell-') && key !== SHELL) await caches.delete(key)
    await self.clients.claim()
  })())
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

function offlineJson() {
  return new Response(JSON.stringify({ detail: 'Нужно подключение к серверу' }), {
    status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Allur-Offline': '1' },
  })
}

async function apiNetworkFirst(request) {
  const cache = await caches.open(API)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS)
  try {
    const res = await fetch(request, { signal: ctrl.signal })
    if (res.ok) await cache.put(request, res.clone())
    return res
  } catch {
    const hit = await cache.match(request)
    if (!hit) return offlineJson()
    // помечаем: это сохранённый ответ, а не живой сервер — интерфейс покажет «офлайн-режим»
    const headers = new Headers(hit.headers)
    headers.set('X-Allur-Offline', '1')
    return new Response(await hit.blob(), { status: hit.status, statusText: hit.statusText, headers })
  } finally {
    clearTimeout(timer)
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return                       // POST/PUT/DELETE — только сеть, без кеша
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/sim/stream' || (req.headers.get('accept') || '').includes('text/event-stream')) return  // SSE
    if (API_CACHEABLE.includes(url.pathname)) event.respondWith(apiNetworkFirst(req))
    return                                               // остальные расчёты — сеть; без сети страница сама берёт replay
  }

  if (req.mode === 'navigate') {
    // любая страница (/, /vote) — оболочка приложения из кеша; маршрутизация на клиенте
    event.respondWith((async () => (await caches.match('/index.html', { cacheName: SHELL })) || fetch(req))())
    return
  }

  event.respondWith((async () => (await caches.match(req, { cacheName: SHELL, ignoreSearch: url.pathname.startsWith('/bundles/') })) || fetch(req))())
})
