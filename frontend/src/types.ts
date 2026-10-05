export type Source = 'fact' | 'calc' | 'assumption' | 'sim' | 'forecast' | 'feedback'
export type Severity = 'ok' | 'info' | 'warn' | 'critical'
export type AreaId = 'warehouse_in' | 'welding' | 'paint' | 'assembly' | 'qc' | 'warehouse_out'

export interface Provenance { file: string; table: number; row: number }
export interface Metric { label: string; value: number | string; unit: string; source: Source }
export interface Finding {
  id: string; title: string; severity: Severity; area: AreaId | null
  summary: string; metrics: Metric[]; caveat: string | null; provenance: Provenance[]
}
export interface Area { id: AreaId; name: string; order: number }
export interface LineRecord { date: string; line: string; area: AreaId; plan: number; fact: number; runtime_h: number; utilization_pct: number; provenance: Provenance }
export interface DowntimeRecord { date: string; area: AreaId; asset_id: string; equipment: string; reason: string; minutes: number; planned: boolean; provenance: Provenance }
export interface ModelPlan { model: string; monthly_plan: number; provenance: Provenance }
export interface QualityRecord { date: string; area: AreaId; produced: number; defects: number; defect_pct_reported: number; provenance: Provenance }
export interface Targets { shifts_per_day: number; shift_hours: number; oee_min_pct: number; defect_max_pct: number; critical_downtime_max_min_per_day: number; monthly_output_min: number }
export interface Facts { source_file: string; route: Area[]; lines: LineRecord[]; downtime: DowntimeRecord[]; model_plan: ModelPlan[]; quality: QualityRecord[]; targets: Targets }
