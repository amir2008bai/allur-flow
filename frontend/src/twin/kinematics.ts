// Два звена ABB и вертикальный инструмент. Размеры условные, контакт с кузовом геометрический.
export type Point3 = readonly [number, number, number]
export type RobotPose = [number, number, number, number]
export const UPPER_ARM = 1.7
export const FOREARM = 1.3
export const TOOL = 0.58
export const SHOULDER_Y = 0.2 + 0.32 + 0.55
export const WELD_SEAMS: Point3[] = [[-1.15, 1.1, -0.82], [-0.7, 1.1, -0.82], [-0.2, 1.1, -0.82], [0.15, 1.1, -0.82]]
const acos = (v: number) => Math.acos(Math.max(-1, Math.min(1, v)))

/** IK: инструмент направлен вниз и заканчивается точно в заданной точке шва. */
export function weldPose(x: number, z: number, target: Point3): RobotPose {
  const dx = target[0] - x, dz = target[2] - z
  const reach = Math.hypot(dx, dz)
  const dy = target[1] + TOOL - SHOULDER_Y
  const distance = Math.hypot(reach, dy)
  const shoulder = -(Math.atan2(reach, dy) - acos((UPPER_ARM ** 2 + distance ** 2 - FOREARM ** 2) / (2 * UPPER_ARM * distance)))
  const elbow = -acos((distance ** 2 - UPPER_ARM ** 2 - FOREARM ** 2) / (2 * UPPER_ARM * FOREARM))
  return [Math.atan2(-dz, dx), shoulder, elbow, Math.PI - shoulder - elbow]
}
