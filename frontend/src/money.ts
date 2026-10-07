// Деньги: модели и план — факт из данных; цены, маржа % и календарь — допущения (A8), меняются в калькуляторе.
import { create } from 'zustand'

export interface CarModel { model: string; plan_month: number; share: number; price: number }
export interface MoneyCfg { models: CarModel[]; pct: number; days: number; shifts: number }

// Тестовые данные ТЗ — пока /api/sim/meta не ответил (реальные модели придут с сервера через init).
const DEFAULT_MODELS: CarModel[] = [
  { model: 'Chevrolet Onix', plan_month: 2500, share: 2500 / 4800, price: 7_500_000 },
  { model: 'Chevrolet Cobalt', plan_month: 1800, share: 1800 / 4800, price: 7_300_000 },
  { model: 'JAC J7', plan_month: 500, share: 500 / 4800, price: 8_500_000 },
]
const DEFAULT: MoneyCfg = { models: DEFAULT_MODELS, pct: 5, days: 22, shifts: 2 }
const KEY = 'allur.money.v2'

type Saved = { prices?: Record<string, number>; pct?: number; days?: number; shifts?: number }
function readSaved(): Saved { try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} } }
function apply(models: CarModel[], s: Saved): MoneyCfg {
  return { models: models.map((m) => ({ ...m, price: s.prices?.[m.model] ?? m.price })), pct: s.pct ?? DEFAULT.pct, days: s.days ?? DEFAULT.days, shifts: s.shifts ?? DEFAULT.shifts }
}

/** Маржа одной машины: цена × маржа %. Средняя — по доле модели в плане. */
export const marginOf = (m: CarModel, pct: number) => m.price * pct / 100
export const avgMargin = (c: MoneyCfg) => c.models.reduce((s, m) => s + m.share * marginOf(m, c.pct), 0)

interface Store extends MoneyCfg {
  base: CarModel[]          // модели с ценами по умолчанию (с сервера)
  margin: number            // средняя маржа с машины
  init: (models: CarModel[]) => void
  set: (p: Partial<Omit<MoneyCfg, 'models'>>) => void
  setPrice: (model: string, price: number) => void
  reset: () => void
  isDefault: () => boolean
}

function save(c: MoneyCfg, base: CarModel[]) {
  const prices = Object.fromEntries(c.models.filter((m) => m.price !== base.find((b) => b.model === m.model)?.price).map((m) => [m.model, m.price]))
  try { localStorage.setItem(KEY, JSON.stringify({ prices, pct: c.pct, days: c.days, shifts: c.shifts })) } catch { /* без хранилища — только в этой вкладке */ }
}

const start = apply(DEFAULT_MODELS, readSaved())
export const useMoney = create<Store>((set, get) => ({
  ...start, base: DEFAULT_MODELS, margin: avgMargin(start),
  init: (models) => {
    if (!models.length) return
    const c = apply(models, readSaved())
    set({ ...c, base: models, margin: avgMargin(c) })
  },
  set: (p) => { const c = { ...get(), ...p }; save(c, get().base); set({ ...p, margin: avgMargin(c) }) },
  setPrice: (model, price) => {
    const models = get().models.map((m) => (m.model === model ? { ...m, price } : m))
    const c = { ...get(), models }; save(c, get().base); set({ models, margin: avgMargin(c) })
  },
  reset: () => {
    try { localStorage.removeItem(KEY) } catch { /* */ }
    const c = { ...DEFAULT, models: get().base }
    set({ ...c, margin: avgMargin(c) })
  },
  isDefault: () => {
    const g = get()
    return g.pct === DEFAULT.pct && g.days === DEFAULT.days && g.shifts === DEFAULT.shifts && g.models.every((m) => m.price === g.base.find((b) => b.model === m.model)?.price)
  },
}))

/** Сколько машин каждой модели в N машинах — по доле в плане. */
export function splitByModel(n: number, models: CarModel[], whole = false) {
  const raw = models.map((m) => ({ model: m.model, n: n * m.share }))
  if (!whole) return raw
  // целые машины, сумма ровно n: метод наибольшего остатка
  const out = raw.map((r) => ({ model: r.model, n: Math.floor(r.n), rest: r.n - Math.floor(r.n) }))
  let left = Math.round(n) - out.reduce((a, r) => a + r.n, 0)
  for (const r of [...out].sort((a, b) => b.rest - a.rest)) { if (left <= 0) break; r.n += 1; left -= 1 }
  return out.map(({ model, n }) => ({ model, n }))
}

/** Тенге коротко: 1,2 млрд ₸ · 35,4 млн ₸ · 850 тыс. ₸ */
export function tenge(x: number): string {
  const a = Math.abs(x), sign = x < 0 ? '−' : ''
  const f = (v: number, d: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: d })
  if (a >= 1e9) return `${sign}${f(a / 1e9, 2)} млрд ₸`
  if (a >= 1e6) return `${sign}${f(a / 1e6, a >= 1e8 ? 0 : 1)} млн ₸`
  if (a >= 1e3) return `${sign}${f(a / 1e3, 0)} тыс. ₸`
  return `${sign}${f(a, 0)} ₸`
}

/** Эффект действия в месяц. Пока до плана не хватает — деньги считаем только ДО плана (план — это заказ, его продадут);
 *  машины сверх плана приносят маржу, только если на них есть спрос, — показываем отдельно.
 *  План уже выполняется → весь прирост «сверх плана», с пометкой про спрос. */
export function effect(deltaPerShift: number, cost: { month: number; once: number }, c: { margin: number; days: number; shifts: number }, gapPerShift = Infinity) {
  const shiftsMonth = c.days * c.shifts
  const gap = Math.max(0, gapPerShift)
  const mode: 'plan' | 'extra' = gap > 0.5 ? 'plan' : 'extra'
  const toPlanCars = Math.min(deltaPerShift, gap) * shiftsMonth
  const aboveCars = Math.max(0, deltaPerShift - gap) * shiftsMonth
  const cars = mode === 'plan' ? toPlanCars : toPlanCars + aboveCars
  const netMonth = cars * c.margin - cost.month
  const netYear = netMonth * 12 - cost.once
  const paybackDays = cost.once > 0 && netMonth > 0 ? Math.ceil(cost.once / (netMonth / c.days)) : null
  return { mode, shiftsMonth, cars, aboveMonth: mode === 'plan' ? aboveCars * c.margin : 0, closesGap: deltaPerShift >= gap, netMonth, netYear, paybackDays }
}

// Модели и цены по умолчанию — с сервера (после загрузки реальных данных там будут их модели).
fetch('/api/sim/meta').then((r) => (r.ok ? r.json() : null)).then((m) => { if (m?.models) useMoney.getState().init(m.models) }).catch(() => { /* офлайн — тестовые модели */ })
