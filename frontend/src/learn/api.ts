// Типы и вызовы API самообучения.
export interface EvalPoint { votes: number; version: number; agreement: number | null; precision: number | null; recall: number | null; shown: number; total: number; false_suppressed: number }
export interface AlertsState {
  version: string; votes: number; human_votes: number; simulated_votes: number; left: number
  start: EvalPoint; now: EvalPoint; curve: EvalPoint[]
  types: { type: string; title: string; confirmed: number; rejected: number; confirm_rate: number; muted: boolean }[]
  note: string
}
export interface Card { id: string; type: string; title: string; text: string; time: string; model_confidence: number; left: number }

export interface ForecastRow { t: number; y: number; champion: number; frozen: number | null; naive: number; plan: number; mae_champion: number | null; mae_frozen: number | null; mae_naive: number | null; mae_served: number | null; served: number; serving: 'model' | 'naive' | 'tsfm' | 'lgbm' | 'ens'; mae_tsfm?: number | null; version: string; lo?: number | null; hi?: number | null; target_t: number; lgbm?: number | null; ens?: number | null }
export interface TsfmModel { model: string; mae_after_drift?: number; ms_per_forecast?: number; vs_ours?: number; beats_naive?: boolean; admitted?: boolean; error?: string }
export interface ForecastPayload {
  tsfm: { device: string; seeds: number; baselines: Record<string, number>; models: TsfmModel[]; note: string } | null
  interval_min: number; horizon_min: number; plan: number; drift_at: number; warmup: number; version: string; note: string
  timeline: ForecastRow[]
  events: { t: number; type: 'drift' | 'promotion' | 'freeze' | 'serve_model' | 'serve_naive' | 'serve_tsfm'; text: string }[]
  multi_seed: { seeds: number; mae_after_drift: Record<string, number>; beats_frozen: number; beats_naive: number; gain_vs_frozen: number; gain_vs_naive: number
    interval?: { target: number; coverage: number; coverage_after_drift: number; width: number } }
  global?: GlobalState
}
export interface GlobalVersion { version: number; trained_at: number; runs: number; rows: number; days: number; holdout_mae: number; holdout_mae_naive: number; seconds: number; promoted: boolean; verdict: string }
export interface GlobalState { running: boolean; progress: number; stage: string; last_error: string | null; current: number | null; versions: GlobalVersion[] }
export interface TwinFit {
  days: number; enough_data: boolean; applied: boolean; is_test: boolean; dataset: string; note: string
  areas: { area: string; records: number; fact_down: number; twin_before: number; twin_after: number }[]
  good_per_shift: { before: number; after: number }
  changes: { area: string; mtbf_before: number; mtbf_after: number; mttr_before: number; mttr_after: number }[]
}
export interface CalibVersion { version: number; trigger: string; mean: number; lo90: number; hi90: number; p_above_norm: number; n: number; defects: number; forecast: { good_per_shift: number; lo: number; hi: number } }
export interface CameraLog { ts: number; defect: boolean; defect_class: string | null; body_id: string | null; source: string }
export interface CameraState { seen: number; defects: number; log: CameraLog[]; calib: CalibState }
export interface CalibState { norm: number; camera: { seen: number; defects: number }; current: CalibVersion; history: CalibVersion[]; observations: { produced: number; defects: number; source: string; who: string }[] }

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
  camera: (): Promise<CameraState> => fetch('/api/learn/camera').then(j),
  cameraDemo: (n = 20): Promise<CameraState> => post(`/api/learn/camera/demo?n=${n}`),
  reset: () => post('/api/learn/reset'),
  retrain: (runs = 400): Promise<GlobalState> => post(`/api/learn/retrain?runs=${runs}`),
  retrainStatus: (): Promise<GlobalState> => fetch('/api/learn/retrain').then(j),
  twinFit: (): Promise<TwinFit> => fetch('/api/data/twin-fit').then(j),
}

export const pct = (x: number | null | undefined, d = 0) => (x == null ? '—' : `${(100 * x).toFixed(d).replace('.', ',')}%`)
