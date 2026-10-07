// Общая «физика» движения 3D-сцены: плавные разгон/торможение и кривые как в интерфейсах Apple.
import * as THREE from 'three'

export const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
export const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
export const easeOutCubic = (x: number) => 1 - Math.pow(1 - clamp01(x), 3)
export const smoothstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t) }

/** Критически задемпфированное приближение к цели: без рывков и перелёта (lambda — «жёсткость»). */
export const damp = (cur: number, target: number, lambda: number, dt: number) => THREE.MathUtils.damp(cur, target, lambda, Math.min(dt, 0.1))

/** «Дыхание»: мягкая волна 0…1 с паузой внизу — спокойнее синуса. */
export const breathe = (t: number, period: number) => {
  const p = (t % period) / period
  return Math.pow(Math.sin(Math.PI * p), 2)
}

/** Время, которое течёт со скоростью 0…1: участок останавливается плавно, а не замирает на полуслове. */
export class Drive {
  t = 0
  speed = 0
  constructor(phase = 0) { this.t = phase }
  step(dt: number, on: boolean, lambda = 3) {
    this.speed = damp(this.speed, on ? 1 : 0, lambda, dt)
    this.t += Math.min(dt, 0.1) * this.speed
    return this.t
  }
}
