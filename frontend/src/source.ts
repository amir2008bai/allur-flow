// Источник данных двойника: живой сервер или записанные прогоны (replay) — если сервер недоступен.
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
    return { data: (await (await withTimeout(live, liveTimeoutMs)).json()) as T, mode: 'live' }
  } catch {
    return { data: (await (await fetch(replay)).json()) as T, mode: 'replay' }
  }
}

export interface SimMeta {
  stations: { id: string; name: string }[]
  buffers: { id: string; name: string; cap: number }[]
  scenarios: { id: string; name: string }[]
  interventions: { id: string; name: string; detail: string }[]
  assumptions: { id: string; text: string; source: string }[]
}

export interface SimRun {
  source: 'sim'; scenario: string; scenario_name?: string; seed: number; horizon: number; buffer_cap: Record<string, number>
  kpi: {
    good_per_shift: number; plan_per_shift: number; scrapped: number; oee_pct: number; oee_note: string
    defect_pct: Record<string, number>; downtime_min: Record<string, number>
    unplanned_downtime_min_per_day: Record<string, number>
    state_shares: Record<string, { working: number; starved: number; blocked: number; down: number }>
  }
  bottleneck: { sole: Record<string, number>; shifting: Record<string, number>; top: string; timeline: { t: number; station: string | null }[] }
  stops: { t: number; station: string; minutes: number; planned: boolean; reason: string }[]
  frames: { t: number; states: Record<string, string>; buffers: Record<string, number>; good: number }[]
  alerts?: { t: number; title: string; text: string }[]
}

export interface WhatIf {
  reps: number; scenario: string
  baseline: { good_per_shift: number; bottleneck: string }
  options: { id: string; name: string; detail: string; good_per_shift: number; delta_per_shift: number; ci95: [number, number]; significant: boolean; closes_gap: boolean; bottleneck_after: string; do?: string; cost?: string; changes?: { what: string; before: number | string; after: number | string; unit: string; source: string }[] }[]
  plan_per_shift: number; gap_per_shift: number; useful?: string[]
  combo: { ids: string[]; names: string[]; good_per_shift: number; delta_per_shift: number; ci95: [number, number]; closes_gap: boolean } | null
}
