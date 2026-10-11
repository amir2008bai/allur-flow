// PIN администратора для публичного демо: сервер отвечает 403 pin_required на изменения без PIN.
// Тогда спрашиваем PIN один раз, храним до закрытия вкладки и повторяем запрос. Локально (без PIN на сервере) ничего не меняется.
const KEY = 'allur.pin'
const read = () => { try { return sessionStorage.getItem(KEY) || '' } catch { return '' } }
const save = (v: string) => { try { sessionStorage.setItem(KEY, v) } catch { /* без хранилища — спросим снова */ } }

export function installPinFetch() {
  const orig = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
    if (method === 'GET' || !url.includes('/api/')) return orig(input, init)
    const withPin = (pin: string) => {
      const h = new Headers(init.headers || (input instanceof Request ? input.headers : undefined))
      if (pin) h.set('X-Admin-PIN', pin)
      return orig(input, { ...init, headers: h })
    }
    const res = await withPin(read())
    if (res.status !== 403) return res
    const body = await res.clone().json().catch(() => null)
    if (body?.detail !== 'pin_required') return res
    const pin = window.prompt('Это действие меняет данные демо. Введите PIN администратора:')
    if (!pin) return res
    save(pin)
    return withPin(pin)
  }
}
