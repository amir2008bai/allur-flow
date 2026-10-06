// Даты смен: у каждой даты своя смена симуляции (детерминированно), чтобы был «архив по датам».
const pad = (n: number) => String(n).padStart(2, '0')
export const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const todayISO = () => toISO(new Date())
export const fromISO = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
export const addDays = (s: string, n: number) => { const d = fromISO(s); d.setDate(d.getDate() + n); return toISO(d) }
export const seedFromDate = (s: string) => { const d = fromISO(s); return ((d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate()) % 997) + 1 }

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
export const longDate = (s: string) => { const d = fromISO(s); return `${WD[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` }
export const shortDate = (s: string) => { const d = fromISO(s); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}` }
/** Минута смены → «06.10 13:20» (смена начинается в 08:00). */
export const stamp = (s: string, t: number) => {
  const m = Math.floor(t) + 8 * 60
  const day = addDays(s, Math.floor(m / 1440))
  return `${shortDate(day)} ${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`
}
