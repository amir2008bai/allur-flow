import { QuadraticBezierLine } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { ROLE_HEX, ZONE_POS, type CauseStep } from './cause'
import type { ZoneId } from './layout'
import { useMotionFrame } from './SceneMotion'
import { STATUS } from '../theme'

const H = (z: ZoneId) => (z === 'paint' ? 5.2 : 4.2)
const P = (z: ZoneId, dy = 0) => new THREE.Vector3(ZONE_POS[z].x, H(z) + dy, ZONE_POS[z].z)

/** Пары «откуда → куда» в порядке распространения: причина → вниз по потоку → выпуск; причина → вверх по потоку. */
export function causeLinks(steps: CauseStep[]): [CauseStep, CauseStep][] {
  if (!steps.length) return []
  const root = steps[0]
  const order: ZoneId[] = ['warehouse_in', 'welding', 'paint', 'assembly', 'qc', 'warehouse_out']
  const ri = order.indexOf(root.zone)
  const down = steps.filter((s) => order.indexOf(s.zone) > ri).sort((a, b) => order.indexOf(a.zone) - order.indexOf(b.zone))
  const up = steps.filter((s) => order.indexOf(s.zone) < ri).sort((a, b) => order.indexOf(b.zone) - order.indexOf(a.zone))
  const links: [CauseStep, CauseStep][] = []
  let prev = root
  for (const s of down) { links.push([prev, s]); prev = s }
  prev = root
  for (const s of up) { links.push([prev, s]); prev = s }
  return links
}

/** Один спокойный импульс при появлении причины, без бесконечной тревожной пульсации. */
function Shockwave({ zone }: { zone: ZoneId }) {
  const rings = useRef<THREE.Mesh[]>([])
  const z = ZONE_POS[zone]
  const born = useRef<number | null>(null)
  useMotionFrame(({ time, reduced }) => {
    if (born.current === null) born.current = time
    rings.current.forEach((m, i) => {
      if (!m) return
      const k = reduced ? 0 : Math.min(1, Math.max(0, (time - born.current! - i * 0.35) / 2.4))
      m.scale.setScalar(1 + k * 0.35)
      ;(m.material as THREE.MeshBasicMaterial).opacity = reduced ? 0.1 : 0.2 * (1 - k)
    })
  })
  return (
    <group position={[z.x, 0.06, z.z]} rotation={[-Math.PI / 2, 0, 0]}>
      {[0].map((i) => (
        <mesh key={i} ref={(m) => { if (m) rings.current[i] = m }}>
          <ringGeometry args={[Math.max(z.w, z.d) * 0.45, Math.max(z.w, z.d) * 0.5, 64]} />
          <meshBasicMaterial color={STATUS.down.hex} transparent opacity={0.2} toneMapped={false} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

/** Светящаяся дуга со «сгустком», бегущим от причины к следствию. */
function Arc({ from, to, color, delay }: { from: ZoneId; to: ZoneId; color: string; delay: number }) {
  const a = P(from), b = P(to)
  const mid = useMemo(() => a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 3 + a.distanceTo(b) * 0.12, 0)), [from, to]) // eslint-disable-line react-hooks/exhaustive-deps
  const curve = useMemo(() => new THREE.QuadraticBezierCurve3(a, mid, b), [mid]) // eslint-disable-line react-hooks/exhaustive-deps
  const orb = useRef<THREE.Mesh>(null)
  const halo = useRef<THREE.Mesh>(null)
  const born = useRef<number | null>(null)
  const p = useMemo(() => new THREE.Vector3(), [])
  useMotionFrame(({ time, reduced }) => {
    if (born.current === null) born.current = time
    const elapsed = time - born.current - delay
    const k = Math.min(1, Math.max(0, elapsed / 1.5))
    const visible = !reduced && elapsed >= 0 && elapsed < 1.5
    curve.getPoint(k, p)
    orb.current?.position.copy(p)
    halo.current?.position.copy(p)
    if (orb.current) orb.current.visible = visible
    if (halo.current) halo.current.visible = visible
  })
  return (
    <group>
      <QuadraticBezierLine start={a} end={b} mid={mid} color={color} lineWidth={1.5} transparent opacity={0.55} />
      <mesh ref={orb} visible={false}><sphereGeometry args={[0.2, 12, 12]} /><meshBasicMaterial color={color} toneMapped={false} /></mesh>
      <mesh ref={halo} visible={false}><sphereGeometry args={[0.4, 12, 12]} /><meshBasicMaterial color={color} transparent opacity={0.12} toneMapped={false} depthWrite={false} /></mesh>
    </group>
  )
}

/** Всё вместе: волна у причины + дуги по цепочке. */
export function CauseFx3D({ steps }: { steps: CauseStep[] }) {
  if (!steps.length) return null
  return (
    <group>
      <Shockwave zone={steps[0].zone} />
      {causeLinks(steps).map(([f, t], i) => <Arc key={f.zone + t.zone} from={f.zone} to={t.zone} color={ROLE_HEX[t.role]} delay={i * 0.8} />)}
    </group>
  )
}

/** Номера шагов над участками — DOM-подписи, позиция пересчитывается каждый кадр. */
export function CauseProjector({ steps, refs }: { steps: CauseStep[]; refs: MutableRefObject<Record<string, HTMLDivElement | null>> }) {
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera, size }) => {
    camera.updateMatrixWorld()
    for (const s of steps) {
      const el = refs.current[s.zone]
      if (!el) continue
      v.copy(P(s.zone, 2.2)).project(camera)
      el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`
      el.style.visibility = v.z < 1 ? 'visible' : 'hidden'
    }
  })
  return null
}

export function CauseBadges({ steps, refs }: { steps: CauseStep[]; refs: MutableRefObject<Record<string, HTMLDivElement | null>> }) {
  return (
    <>
      {steps.map((s) => (
        <div key={s.zone} ref={(el) => { refs.current[s.zone] = el }} style={{ visibility: 'hidden' }} className="pointer-events-none absolute left-0 top-0">
          <div className="flex items-center gap-1.5 rounded-full bg-white/95 py-0.5 pl-0.5 pr-2.5 text-xs font-semibold shadow-lg ring-1 ring-slate-200">
            <span className="grid h-5 w-5 place-items-center rounded-full text-[11px] text-white" style={{ background: ROLE_HEX[s.role] }}>{s.order}</span>
            {s.role === 'cause' ? 'причина' : s.role === 'result' ? 'итог' : 'следствие'}
          </div>
        </div>
      ))}
    </>
  )
}
