type JournalOptions = RequestInit & { timeoutMs?: number; retryDelayMs?: number }

/** Одна повторная попытка только для чтения при временной ошибке.
 * Таймаут и отмена не превращаются в бесконечное ожидание. */
export async function journalRequest<T>(url: string, options: JournalOptions = {}): Promise<T> {
  const { signal, timeoutMs = 45_000, retryDelayMs = 800, ...init } = options
  const attempts = !init.method || init.method.toUpperCase() === 'GET' ? 2 : 1
  for (let attempt = 0; attempt < attempts; attempt++) {
    signal?.throwIfAborted()
    const controller = new AbortController()
    const cancel = () => controller.abort()
    signal?.addEventListener('abort', cancel, { once: true })
    const timer = setTimeout(cancel, timeoutMs)
    let retryable = false
    try {
      const response = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' })
      if (!response.ok) {
        retryable = response.status >= 500
        throw new Error(retryable ? 'Сервер временно не смог загрузить журнал.' : 'Не удалось загрузить журнал. Обновите страницу и попробуйте ещё раз.')
      }
      const data = await response.json()
      if (!data || typeof data !== 'object') throw new Error('Сервер вернул неполный ответ. Попробуйте ещё раз.')
      return data as T
    } catch (error) {
      if (signal?.aborted) throw error
      if (controller.signal.aborted) throw new Error('Расчёт занял слишком много времени. Нажмите «Повторить» — сервер мог уже завершить его.')
      if (error instanceof TypeError) retryable = true
      if (!retryable || attempt + 1 === attempts) {
        throw error instanceof TypeError ? new Error('Нет связи с сервером. Проверьте подключение и попробуйте ещё раз.') : error
      }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
  }
  throw new Error('Не удалось загрузить журнал.')
}
