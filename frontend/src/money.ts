// Деньги: маржа и календарь — допущения пользователя (A8). Хранятся в браузере как удобство.
import { create } from 'zustand'

export interface MoneyCfg { margin: number; days: number; shifts: number }
const DEFAULT: MoneyCfg = { margin: 400_000, days: 22, shifts: 2 }
const KEY = 'allur.money'

function read(): MoneyCfg {
  try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return DEFAULT }
}

export const useMoney = create<MoneyCfg & { set: (p: Partial<MoneyCfg>) => void; reset: () => void; isDefault: () => boolean }>((set, get) => ({
  ...read(),
  set: (p) => set(() => {
    const next = { margin: get().margin, days: get().days, shifts: get().shifts, ...p }
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* без хранилища — только в этой вкладке */ }
    return next
  }),
  reset: () => { try { localStorage.removeItem(KEY) } catch { /* */ } set(DEFAULT) },
  isDefault: () => get().margin === DEFAULT.margin && get().days === DEFAULT.days && get().shifts === DEFAULT.shifts,
}))

/** Тенге коротко: 1,2 млрд ₸ · 35,4 млн ₸ · 850 тыс. ₸ */
export function tenge(x: number): string {
  const a = Math.abs(x), sign = x < 0 ? '−' : ''
  const f = (v: number, d: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: d })
  if (a >= 1e9) return `${sign}${f(a / 1e9, 2)} млрд ₸`
  if (a >= 1e6) return `${sign}${f(a / 1e6, a >= 1e8 ? 0 : 1)} млн ₸`
  if (a >= 1e3) return `${sign}${f(a / 1e3, 0)} тыс. ₸`
  return `${sign}${f(a, 0)} ₸`
}

/** Эффект действия: +машин за смену → деньги в месяц и год за вычетом затрат; окупаемость разовых вложений. */
export function effect(deltaPerShift: number, cost: { month: number; once: number }, c: MoneyCfg) {
  const shiftsMonth = c.days * c.shifts
  const carsMonth = deltaPerShift * shiftsMonth
  const grossMonth = carsMonth * c.margin
  const netMonth = grossMonth - cost.month
  const netYear = netMonth * 12 - cost.once
  const paybackDays = cost.once > 0 && netMonth > 0 ? Math.ceil(cost.once / (netMonth / c.days)) : null
  return { shiftsMonth, carsMonth, grossMonth, netMonth, netYear, paybackDays }
}
