// Типы и вызовы API самообучения.
export interface EvalPoint { votes: number; version: number; agreement: number | null; precision: number | null; recall: number | null; shown: number; total: number; false_suppressed: number }
export interface AlertsState {
  version: string; votes: number; human_votes: number; simulated_votes: number; left: number
  start: EvalPoint; now: EvalPoint; curve: EvalPoint[]
  types: { type: string; title: string; confirmed: number; rejected: number; confirm_rate: number; muted: boolean }[]
  note: string
}
export interface Card { id: string; type: string; title: string; text: string; time: string; model_confidence: number; left: number }

export interface ForecastRow { t: number; y: number; champion: number; frozen: number | null; naive: number; plan: number; mae_champion: number | null; mae_frozen: number | null; mae_naive: number | null; mae_served: number | null; served: number; serving: 'model' | 'naive'; version: string }
export interface ForecastPayload {
  interval_min: number; horizon_min: number; plan: number; drift_at: number; warmup: number; version: string; note: string
  timeline: ForecastRow[]
  events: { t: number; type: 'drift' | 'promotion' | 'freeze' | 'serve_model' | 'serve_naive'; text: string }[]
  multi_seed: { seeds: number; mae_after_drift: Record<string, number>; beats_frozen: number; beats_naive: number; gain_vs_frozen: number; gain_vs_naive: number }
}
export interface CalibVersion { version: number; trigger: string; mean: number; lo90: number; hi90: number; p_above_norm: number; n: number; defects: number; forecast: { good_per_shift: number; lo: number; hi: number } }
export interface CalibState { norm: number; current: CalibVersion; history: CalibVersion[]; observations: { produced: number; defects: number; source: string; who: string }[] }

const j = (r: Response) => { if (!r.ok) throw new Error(String(r.status)); return r.json() }
const post = (url: string, body?: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(j)

export const api = {
  forecast: (): Promise<ForecastPayload> => fetch('/api/learn/forecast').then(j),
  alerts: (): Promise<AlertsState> => fetch('/api/learn/alerts/state').then(j),
  next: (skip: string[] = []): Promise<{ card: Card | null }> => fetch(`/api/learn/alerts/next?skip=${skip.join(',')}`).then(j),
  vote: (alert_id: string, verdict: 'confirm' | 'reject', voter: string): Promise<AlertsState> => post('/api/learn/alerts/vote', { alert_id, verdict, voter }),
  simulate: (n = 10): Promise<AlertsState> => post(`/api/learn/alerts/simulate?n=${n}`),
  calib: (): Promise<CalibState> => fetch('/api/learn/calib').then(j),
  calibAdd: (produced: number, defects: number, who: string): Promise<CalibState> => post('/api/learn/calib', { produced, defects, who }),
  calibUndo: (): Promise<CalibState> => post('/api/learn/calib/undo'),
  reset: () => post('/api/learn/reset'),
}

export const pct = (x: number | null | undefined, d = 0) => (x == null ? '—' : `${(100 * x).toFixed(d).replace('.', ',')}%`)
