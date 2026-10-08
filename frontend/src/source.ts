// Источник данных двойника: живой сервер или записанные прогоны (replay) — если сервер недоступен.
import { useNet } from './net'

export type Mode = 'live' | 'replay'

async function withTimeout(url: string, ms = 2500): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctrl.signal })
    if (!r.ok) throw new Error(String(r.status))
    return r
  } finally {
    clearTimeout(t)
  }
}

export async function load<T>(live: string, replay: string, liveTimeoutMs?: number): Promise<{ data: T; mode: Mode }> {
  try {
    if (useNet.getState().server === false) throw new Error('offline')   // уже знаем, что сервера нет — не ждём отказа соединения
    const r = await withTimeout(live, liveTimeoutMs)
    // сохранённый сервис-воркером ответ — это не живой сервер: честно показываем «офлайн-режим»
    return { data: (await r.json()) as T, mode: r.headers.get('X-Allur-Offline') === '1' ? 'replay' : 'live' }
  } catch {
    return { data: (await (await fetch(replay)).json()) as T, mode: 'replay' }
  }
}

export interface SimMeta {
  stations: { id: string; name: string }[]
  buffers: { id: string; name: string; cap: number }[]
  scenarios: { id: string; name: string }[]
  interventions: { id: string; name: string; detail: string; money?: Money }[]
  models?: { model: string; plan_month: number; share: number; price: number; margin: number }[]
  money?: { margin_pct: number; work_days_month: number; shifts_per_day: number; note: string }
  assumptions: { id: string; text: string; source: string }[]
}

/** OEE = доступность × темп × качество и потери в машинах (каскад потерь). */
export interface OeeParts {
  availability: number; performance: number; quality: number; planned_min: number; availability_loss_min: number
  cars: { ideal: number; availability: number; performance: number; quality: number; good: number }
  cars_by?: { availability: Record<string, number>; quality: Record<string, number>; planned_min: number }
}

export interface SimRun {
  source: 'sim'; scenario: string; scenario_name?: string; seed: number; horizon: number; buffer_cap: Record<string, number>
  kpi: {
    good_per_shift: number; plan_per_shift: number; scrapped: number; oee_pct: number; oee_note: string
    defect_pct: Record<string, number>; downtime_min: Record<string, number>
    unplanned_downtime_min_per_day: Record<string, number>
    state_shares: Record<string, { working: number; starved: number; blocked: number; down: number }>
    oee_parts?: OeeParts
  }
  bottleneck: { sole: Record<string, number>; shifting: Record<string, number>; top: string; timeline: { t: number; station: string | null }[] }
  stops: { t: number; station: string; minutes: number; planned: boolean; reason: string }[]
  frames: { t: number; states: Record<string, string>; buffers: Record<string, number>; good: number }[]
  alerts?: { t: number; title: string; text: string }[]
}

export interface Money { month: number; once: number }

export interface WhatIf {
  reps: number; scenario: string
  baseline: { good_per_shift: number; bottleneck: string }
  options: { id: string; short?: string; name: string; detail: string; good_per_shift: number; delta_per_shift: number; ci95: [number, number]; significant: boolean; closes_gap: boolean; bottleneck_after: string; do?: string; cost?: string; money?: Money; changes?: { what: string; before: number | string; after: number | string; unit: string; source: string }[] }[]
  plan_per_shift: number; gap_per_shift: number; useful?: string[]
  combo: { ids: string[]; names: string[]; shorts?: string[]; good_per_shift: number; delta_per_shift: number; ci95: [number, number]; closes_gap: boolean; money?: Money } | null
}
