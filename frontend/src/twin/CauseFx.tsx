import { QuadraticBezierLine } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { ROLE_HEX, ZONE_POS, type CauseStep } from './cause'
import type { ZoneId } from './layout'

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

/** Ударная волна от причины: расходящиеся красные кольца. */
function Shockwave({ zone }: { zone: ZoneId }) {
  const rings = useRef<THREE.Mesh[]>([])
  const z = ZONE_POS[zone]
  useFrame(({ clock }) => {
    rings.current.forEach((m, i) => {
      if (!m) return
      const k = (clock.elapsedTime * 0.6 + i / 3) % 1
      m.scale.setScalar(1 + k * 2.2)
      ;(m.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - k)
    })
  })
  return (
    <group position={[z.x, 0.06, z.z]} rotation={[-Math.PI / 2, 0, 0]}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(m) => { if (m) rings.current[i] = m }}>
          <ringGeometry args={[Math.max(z.w, z.d) * 0.45, Math.max(z.w, z.d) * 0.5, 64]} />
          <meshBasicMaterial color="#ef4444" transparent opacity={0.4} toneMapped={false} depthWrite={false} />
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
  const line = useRef<any>(null) // eslint-disable-line @typescript-eslint/no-explicit-any
  const orb = useRef<THREE.Mesh>(null)
  const halo = useRef<THREE.Mesh>(null)
  useFrame(({ clock }, dt) => {
    if (line.current?.material) line.current.material.dashOffset -= dt * 2.5
    const k = ((clock.elapsedTime * 0.55 - delay) % 1 + 1) % 1
    const p = curve.getPoint(k)
    orb.current?.position.copy(p)
    halo.current?.position.copy(p)
    if (halo.current) halo.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 8) * 0.15)
  })
  return (
    <group>
      <QuadraticBezierLine ref={line} start={a} end={b} mid={mid} color={color} lineWidth={3} dashed dashScale={2} dashSize={1.2} gapSize={0.8} transparent opacity={0.9} />
      <mesh ref={orb}><sphereGeometry args={[0.32, 20, 20]} /><meshBasicMaterial color={color} toneMapped={false} /></mesh>
      <mesh ref={halo}><sphereGeometry args={[0.7, 20, 20]} /><meshBasicMaterial color={color} transparent opacity={0.25} toneMapped={false} depthWrite={false} /></mesh>
    </group>
  )
}

/** Всё вместе: волна у причины + дуги по цепочке. */
export function CauseFx3D({ steps }: { steps: CauseStep[] }) {
  if (!steps.length) return null
  return (
    <group>
      <Shockwave zone={steps[0].zone} />
      {causeLinks(steps).map(([f, t], i) => <Arc key={f.zone + t.zone} from={f.zone} to={t.zone} color={ROLE_HEX[t.role]} delay={i * 0.25} />)}
    </group>
  )
}

/** Номера шагов над участками — DOM-подписи, позиция пересчитывается каждый кадр. */
export function CauseProjector({ steps, refs }: { steps: CauseStep[]; refs: MutableRefObject<Record<string, HTMLDivElement | null>> }) {
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera, size }) => {
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
