// Причинно-следственная цепочка в момент времени: что сломалось → куда это пошло по линии.
// Строится только по наблюдаемому кадру (состояния участков и буферы), без догадок.
import type { SimRun } from '../source'
import { BUFFERS, ZONES, type ZoneId } from './layout'

export type Role = 'cause' | 'effect' | 'result'
export interface CauseStep { order: number; zone: ZoneId; role: Role; title: string; text: string }

type Frame = SimRun['frames'][number]
const LINE: ZoneId[] = ['welding', 'paint', 'assembly', 'qc']
const NAME: Record<string, string> = { welding: 'Сварка', paint: 'Окраска', assembly: 'Сборка', qc: 'ОТК' }
const bufBefore = (z: ZoneId) => BUFFERS.find((b) => b.to === z)
const bufAfter = (z: ZoneId) => BUFFERS.find((b) => b.from === z)

/** Цепочка строится ТОЛЬКО при реальной потере выпуска:
 *  а) какой-то участок стоит; или б) главный ограничитель линии (задаёт темп всей линии) сам простаивает —
 *  ждёт кузов или ему некуда отдать. Обычная картина (самый медленный участок работает, ОТК быстрее и ждёт) —
 *  это норма любой линии, а не инцидент. */
export function causeChain(frame: Frame | undefined, run: SimRun, _t: number): CauseStep[] {
  if (!frame) return []
  const st = (z: ZoneId) => frame.states[z]
  const constraint = run.bottleneck.top as ZoneId
  let root: ZoneId | undefined = LINE.find((z) => st(z) === 'down')
  let rootText = 'стоит — отказ или остановка'
  if (!root) {
    const cs = st(constraint)
    const ci = LINE.indexOf(constraint)
    if (cs === 'starved') {        // ограничитель ждёт кузов → ищем, кто выше по потоку тормозит
      for (let k = ci - 1; k >= 0; k--) if (st(LINE[k]) !== 'starved') { root = LINE[k]; break }
    } else if (cs === 'blocked') { // ограничителю некуда отдать → ищем, кто ниже по потоку тормозит
      for (let k = ci + 1; k < LINE.length; k++) if (st(LINE[k]) !== 'blocked') { root = LINE[k]; break }
    }
    rootText = 'работает медленнее обычного — задерживает линию'
  }
  if (!root) return []

  const steps: CauseStep[] = [{ order: 1, zone: root, role: 'cause', title: NAME[root], text: rootText }]
  const i = LINE.indexOf(root)
  for (let k = i + 1; k < LINE.length; k++) {   // вниз по потоку: ждут кузов (ОТК — только если ждёт и ограничитель)
    const z = LINE[k]
    if (st(z) !== 'starved') break
    if (z === 'qc' && st(constraint) !== 'starved' && constraint !== root) break
    const b = bufBefore(z)
    steps.push({ order: steps.length + 1, zone: z, role: 'effect', title: NAME[z], text: `ждёт кузов${b ? ` — буфер «${b.name}» ${frame.buffers[b.id] ?? 0} шт.` : ''}` })
  }
  for (let k = i - 1; k >= 0; k--) {            // вверх по потоку: некуда отдать
    const z = LINE[k]
    if (st(z) !== 'blocked') break
    const b = bufAfter(z)
    steps.push({ order: steps.length + 1, zone: z, role: 'effect', title: NAME[z], text: `некуда отдать кузов${b ? ` — буфер полон (${frame.buffers[b.id]}/${run.buffer_cap[b.id]})` : ''}` })
  }
  const lineLoses = st(constraint) !== 'working' || root === constraint
  if (steps.length > 1 || lineLoses) {
    const qcStops = st('qc') === 'starved' || st('qc') === 'down'
    steps.push({ order: steps.length + 1, zone: 'warehouse_out', role: 'result', title: 'Выпуск', text: qcStops && lineLoses ? 'годные машины сейчас не выходят' : 'выпуск под угрозой' })
  }
  return steps.length > 1 ? steps : []
}

export const ZONE_POS = Object.fromEntries(ZONES.map((z) => [z.id, z])) as Record<ZoneId, (typeof ZONES)[number]>
export const ROLE_HEX: Record<Role, string> = { cause: '#ef4444', effect: '#f59e0b', result: '#0f172a' }

// ── Устойчивые инциденты: без мелькания на любой скорости ─────────────────────
export interface Incident { start: number; end: number; steps: CauseStep[]; key: string }
const MIN_MINUTES = 8      // короче — не инцидент, а шум
const MERGE_GAP = 5        // разрывы короче склеиваем
const cache = new WeakMap<SimRun, Incident[]>()

/** Короткие подписи для строки: 2–3 слова на шаг. */
export function shortText(s: CauseStep): string {
  if (s.role === 'result') return s.text.startsWith('годные') ? 'выпуск стоит' : 'выпуск падает'
  if (s.role === 'cause') return s.text.startsWith('стоит') ? 'стоит' : 'тормозит'
  return s.text.startsWith('ждёт') ? 'ждёт кузов' : 'некуда отдать'
}

export function incidents(run: SimRun): Incident[] {
  const hit = cache.get(run)
  if (hit) return hit
  const raw: { t: number; root: string | null; steps: CauseStep[] }[] = []
  for (const f of run.frames) {
    const steps = causeChain(f, run, f.t)
    raw.push({ t: f.t, root: steps[0]?.zone ?? null, steps })
  }
  const segs: Incident[] = []
  let cur: Incident | null = null
  for (const r of raw) {
    if (r.root && cur && cur.key === r.root && r.t - cur.end <= MERGE_GAP) {
      cur.end = r.t
      if (r.steps.length > cur.steps.length) cur.steps = r.steps   // берём самую полную цепочку эпизода
    } else if (r.root) {
      if (cur) segs.push(cur)
      cur = { start: r.t, end: r.t, steps: r.steps, key: r.root }
    }
  }
  if (cur) segs.push(cur)
  const out = segs.filter((s) => s.end - s.start >= MIN_MINUTES)
  cache.set(run, out)
  return out
}
