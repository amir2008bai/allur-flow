// Единая раскладка цеха в метрах — её читают и 3D-сцена, и 2D-схема.
// Компоновка условная (допущение): реального плана цеха Allur в материалах нет.

export type ZoneId = 'warehouse_in' | 'welding' | 'paint' | 'assembly' | 'qc' | 'warehouse_out'
export type BufferId = 'b_weld_paint' | 'b_paint_asm' | 'b_asm_qc'

export interface Zone { id: ZoneId; name: string; short: string; x: number; z: number; w: number; d: number; station?: string; equipment: string[] }
export interface Buf { id: BufferId; name: string; x: number; z: number; from: ZoneId; to: ZoneId }

export const ZONES: Zone[] = [
  { id: 'warehouse_in', name: 'Склад комплектующих', short: 'Склад', x: -36, z: 0, w: 8, d: 12, equipment: [] },
  { id: 'welding', name: 'Сварка', short: 'Сварка', x: -22, z: 0, w: 12, d: 12, station: 'welding', equipment: ['ABB-01', 'ABB-04'] },
  { id: 'paint', name: 'Окраска', short: 'Окраска', x: -3, z: 0, w: 14, d: 12, station: 'paint', equipment: ['Камера-02'] },
  { id: 'assembly', name: 'Сборка', short: 'Сборка', x: 18, z: 0, w: 18, d: 10, station: 'assembly', equipment: ['Конвейер-03'] },
  { id: 'qc', name: 'Контроль качества', short: 'ОТК', x: 35, z: 0, w: 8, d: 10, station: 'qc', equipment: [] },
  { id: 'warehouse_out', name: 'Склад готовой продукции', short: 'Готовая', x: 47, z: 0, w: 8, d: 12, equipment: [] },
]

export const BUFFERS: Buf[] = [
  { id: 'b_weld_paint', name: 'Сварка → Окраска', x: -12.5, z: 0, from: 'welding', to: 'paint' },
  { id: 'b_paint_asm', name: 'Окраска → Сборка', x: 6.5, z: 0, from: 'paint', to: 'assembly' },
  { id: 'b_asm_qc', name: 'Сборка → ОТК', x: 29, z: 0, from: 'assembly', to: 'qc' },
]

export const ZONE_BY_ID = Object.fromEntries(ZONES.map((z) => [z.id, z])) as Record<ZoneId, Zone>
export const ZONE_BY_STATION = Object.fromEntries(ZONES.filter((z) => z.station).map((z) => [z.station!, z])) as Record<string, Zone>

export type StationState = 'working' | 'starved' | 'blocked' | 'down'
export const STATE_RU: Record<StationState, string> = { working: 'работает', starved: 'ждёт кузов', blocked: 'некуда отдать', down: 'стоит' }
// ISA-101: норма — нейтральная, цвет только для отклонений
export const STATE_HEX: Record<StationState, string> = { working: '#e8ebf0', starved: '#cfd5de', blocked: '#f5b942', down: '#ef4444' }
