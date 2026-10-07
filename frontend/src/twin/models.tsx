// Процедурные 3D-модели оборудования и кузовов: без внешних файлов, лёгкие, работают офлайн.
// Анимация включается только когда участок реально работает (состояние из симуляции).
import { RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Drive, clamp01, damp, easeInOutCubic, reducedMotion } from './motion'

// Палитра в духе Apple: белый сатин, графит, анодированный алюминий — спокойно и правдоподобно (роботы ABB белые)
const METAL = { color: '#c9ced6', roughness: 0.3, metalness: 0.7 }
const ALU = { color: '#d7dbe0', roughness: 0.35, metalness: 0.55 }
const ROBOT_SHELL = { color: '#f4f5f7', roughness: 0.38, metalness: 0.05 }
const GRAPHITE = '#3a3f46'

/* ───────────── Кузов-седан ───────────── */
const sedanShape = (() => {
  // профиль сбоку (длина по X, высота по Y), гладкие скругления
  const s = new THREE.Shape()
  s.moveTo(-0.8, 0.12)
  s.lineTo(0.8, 0.12)
  s.quadraticCurveTo(0.86, 0.14, 0.86, 0.26)
  s.quadraticCurveTo(0.84, 0.38, 0.62, 0.4)
  s.lineTo(0.36, 0.42)
  s.quadraticCurveTo(0.24, 0.66, 0.02, 0.67)
  s.lineTo(-0.36, 0.66)
  s.quadraticCurveTo(-0.56, 0.62, -0.66, 0.44)
  s.lineTo(-0.82, 0.4)
  s.quadraticCurveTo(-0.88, 0.32, -0.86, 0.2)
  s.closePath()
  return s
})()
const sedanGeo = (() => {
  const g = new THREE.ExtrudeGeometry(sedanShape, { depth: 0.7, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 3, curveSegments: 16 })
  g.translate(0, 0, -0.35)
  return g
})()
const glassShape = (() => {
  const s = new THREE.Shape()
  s.moveTo(-0.5, 0.44); s.lineTo(0.3, 0.44); s.quadraticCurveTo(0.2, 0.62, 0.02, 0.63); s.lineTo(-0.34, 0.62); s.quadraticCurveTo(-0.48, 0.58, -0.5, 0.44)
  return s
})()
const glassGeo = (() => { const g = new THREE.ExtrudeGeometry(glassShape, { depth: 0.74, bevelEnabled: false }); g.translate(0, 0, -0.37); return g })()
const wheelGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.1, 24).rotateX(Math.PI / 2)

export function Sedan({ position, color = '#f7f8fa', scale = 1, rotY = Math.PI / 2, wheels = true }: { position: [number, number, number]; color?: string; scale?: number; rotY?: number; wheels?: boolean }) {
  return (
    <group position={position} scale={scale} rotation={[0, rotY, 0]}>
      <mesh geometry={sedanGeo} castShadow><meshPhysicalMaterial color={color} roughness={0.25} metalness={0.35} clearcoat={1} clearcoatRoughness={0.15} /></mesh>
      <mesh geometry={glassGeo}><meshStandardMaterial color="#1e2833" roughness={0.1} metalness={0.8} /></mesh>
      {wheels && [[-0.52, 0.38], [0.52, 0.38], [-0.52, -0.38], [0.52, -0.38]].map(([x, z]) => (
        <mesh key={`${x}${z}`} geometry={wheelGeo} position={[x, 0.15, z]}><meshStandardMaterial color="#1b1f24" roughness={0.8} /></mesh>
      ))}
    </group>
  )
}

/* ───────────── Искры / туман: частицы ───────────── */
type Flag = boolean | (() => boolean)
const on = (f: Flag) => (typeof f === 'function' ? f() : f)

function Particles({ active, count = 90, color, size, spread, life, gravity, origin, additive = true, maxOpacity = 0.9 }:
  { active: Flag; count?: number; color: string; size: number; spread: number; life: number; gravity: number; origin: () => THREE.Vector3; additive?: boolean; maxOpacity?: number }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    return g
  }, [count])
  const state = useMemo(() => Array.from({ length: count }, () => ({ p: new THREE.Vector3(0, -99, 0), v: new THREE.Vector3(), age: Math.random() * life })), [count, life])
  const mat = useRef<THREE.PointsMaterial>(null)
  const pts = useRef<THREE.Points>(null)
  const loc = useMemo(() => new THREE.Vector3(), [])
  useFrame((_, dt) => {
    const pos = geo.attributes.position as THREE.BufferAttribute
    const live = on(active)
    // источник задан в мировых координатах → переводим в локальные координаты частиц
    const o = pts.current ? pts.current.worldToLocal(loc.copy(origin())) : loc.copy(origin())
    state.forEach((s, i) => {
      s.age += dt
      if (s.age > life) {
        s.age = 0
        if (live) {
          s.p.copy(o)
          s.v.set((Math.random() - 0.5) * spread, Math.random() * spread * 0.8, (Math.random() - 0.5) * spread)
        } else s.p.set(0, -99, 0)
      }
      s.v.y -= gravity * dt
      s.p.addScaledVector(s.v, dt)
      pos.setXYZ(i, s.p.x, s.p.y, s.p.z)
    })
    pos.needsUpdate = true
    if (mat.current) mat.current.opacity = damp(mat.current.opacity, live ? maxOpacity : 0, 6, dt)
  })
  return (
    <points ref={pts} geometry={geo} frustumCulled={false}>
      <pointsMaterial ref={mat} color={color} size={size} transparent opacity={0} depthWrite={false} blending={additive ? THREE.AdditiveBlending : THREE.NormalBlending} toneMapped={false} />
    </points>
  )
}

/* ───────────── 6-осевой робот сварки (ABB: белый корпус, графитовые узлы) ─────────────
 * Работает как настоящий: переезд к точке шва (плавно), пауза-сварка со вспышкой и искрами, следующая точка.
 * Если участок остановился — робот плавно доводит движение и возвращается в исходную позу. */
type Pose = [number, number, number, number]        // поворот базы, плечо, локоть, кисть
const WELD_POSES: Pose[] = [[-0.55, -0.3, 1.05, 0.55], [-0.2, -0.42, 1.25, 0.7], [0.2, -0.38, 1.2, 0.65], [0.55, -0.26, 1.0, 0.5]]
const HOME: Pose = [0, -0.05, 0.75, 0.35]
const MOVE = 0.85, DWELL = 0.75                      // секунды: переезд и сварка в точке

export function WeldRobot({ x, z, working, phase, flip = false }: { x: number; z: number; working: boolean; phase: number; flip?: boolean }) {
  const turn = useRef<THREE.Group>(null)
  const shoulder = useRef<THREE.Group>(null)
  const elbow = useRef<THREE.Group>(null)
  const wrist = useRef<THREE.Group>(null)
  const tip = useRef<THREE.Object3D>(null)
  const glow = useRef<THREE.Mesh>(null)
  const tmp = useMemo(() => new THREE.Vector3(), [])
  const pose = useRef<Pose>([...HOME])
  const welding = useRef(false)
  const t = useRef(phase * 1.3)
  const still = useMemo(reducedMotion, [])
  useFrame((_, dt) => {
    let target: Pose = HOME
    welding.current = false
    if (working && !still) {
      t.current += Math.min(dt, 0.1)
      const step = MOVE + DWELL
      const i = Math.floor(t.current / step)
      const local = t.current - i * step
      const a = WELD_POSES[i % WELD_POSES.length], b = WELD_POSES[(i + 1) % WELD_POSES.length]
      const k = easeInOutCubic(clamp01(local / MOVE))
      target = a.map((v, j) => v + (b[j] - v) * k) as Pose
      welding.current = local > MOVE + 0.08 && local < step - 0.05
      if (welding.current) target = [target[0], target[1], target[2], target[3] + Math.sin(t.current * 40) * 0.015]   // лёгкое «ведение» горелки
    }
    // при работе следуем траектории точно, при остановке — мягко домой
    const lam = working ? 18 : 2.5
    pose.current = pose.current.map((v, j) => damp(v, target[j], lam, dt)) as Pose
    const [r, s, e, w] = pose.current
    if (turn.current) turn.current.rotation.y = (flip ? Math.PI : 0) + r
    if (shoulder.current) shoulder.current.rotation.z = s
    if (elbow.current) elbow.current.rotation.z = e
    if (wrist.current) wrist.current.rotation.z = w
    if (glow.current) {
      const m = glow.current.material as THREE.MeshBasicMaterial
      const flick = welding.current ? 0.75 + Math.random() * 0.25 : 0
      m.opacity = damp(m.opacity, flick, 30, dt)
      glow.current.scale.setScalar(0.6 + m.opacity * 0.6)
    }
  })
  return (
    <group position={[x, 0.2, z]}>
      <mesh castShadow position={[0, 0.16, 0]}><cylinderGeometry args={[0.62, 0.7, 0.32, 48]} /><meshStandardMaterial color={GRAPHITE} roughness={0.55} metalness={0.2} /></mesh>
      <group ref={turn} position={[0, 0.32, 0]}>
        <mesh castShadow position={[0, 0.24, 0]}><cylinderGeometry args={[0.46, 0.5, 0.48, 48]} /><meshStandardMaterial {...ROBOT_SHELL} /></mesh>
        <group ref={shoulder} position={[0, 0.55, 0]}>
          <mesh castShadow rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.27, 0.27, 0.62, 32]} /><meshStandardMaterial color={GRAPHITE} roughness={0.45} metalness={0.3} /></mesh>
          <RoundedBox args={[0.36, 1.7, 0.36]} radius={0.15} smoothness={6} position={[0, 0.85, 0]} castShadow><meshStandardMaterial {...ROBOT_SHELL} /></RoundedBox>
          <group ref={elbow} position={[0, 1.7, 0]}>
            <mesh castShadow rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.21, 0.21, 0.5, 32]} /><meshStandardMaterial color={GRAPHITE} roughness={0.45} metalness={0.3} /></mesh>
            <RoundedBox args={[0.28, 1.3, 0.28]} radius={0.12} smoothness={6} position={[0, 0.65, 0]} castShadow><meshStandardMaterial {...ROBOT_SHELL} /></RoundedBox>
            <group ref={wrist} position={[0, 1.3, 0]}>
              <mesh castShadow><sphereGeometry args={[0.16, 32, 32]} /><meshStandardMaterial color={GRAPHITE} roughness={0.4} metalness={0.3} /></mesh>
              <mesh castShadow position={[0, 0.3, 0]}><cylinderGeometry args={[0.045, 0.085, 0.5, 24]} /><meshStandardMaterial {...METAL} /></mesh>
              <object3D ref={tip} position={[0, 0.58, 0]} />
              {/* вспышка дуги: маленькое тёплое ядро, только во время сварки */}
              <mesh ref={glow} position={[0, 0.6, 0]}>
                <sphereGeometry args={[0.12, 16, 16]} />
                <meshBasicMaterial color="#fff1d6" transparent opacity={0} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
              </mesh>
            </group>
          </group>
        </group>
      </group>
      {/* искры: короткие, тёплые, только в момент сварки */}
      <Particles active={() => welding.current} count={60} color="#ffc773" size={0.06} spread={2.0} life={0.35} gravity={9} maxOpacity={0.85}
        origin={() => (tip.current ? tip.current.getWorldPosition(tmp) : tmp.set(0, 2, 0))} />
    </group>
  )
}

/* ───────────── Окрасочная камера ───────────── */
function SprayArm({ x, z, working, phase }: { x: number; z: number; working: boolean; phase: number }) {
  const g = useRef<THREE.Group>(null)
  const nozzle = useRef<THREE.Object3D>(null)
  const tmp = useMemo(() => new THREE.Vector3(), [])
  const drive = useMemo(() => new Drive(phase), [phase])
  const still = useMemo(reducedMotion, [])
  useFrame((_, dt) => {
    if (!g.current) return
    const k = drive.step(dt, working && !still, 2.5) * 0.9
    // проход вдоль кузова: плавный разворот у краёв (как реальный покрасочный робот)
    const sweep = easeInOutCubic((Math.sin(k) + 1) / 2) * 2 - 1
    g.current.position.x = x + sweep * 1.6
    g.current.rotation.z = -sweep * 0.12
  })
  return (
    <>
      <group ref={g} position={[x, 3.6, z]}>
        <mesh castShadow position={[0, -0.6, 0]}><cylinderGeometry args={[0.06, 0.06, 1.2, 24]} /><meshStandardMaterial {...ROBOT_SHELL} /></mesh>
        <mesh position={[0, -1.24, 0]}><coneGeometry args={[0.1, 0.22, 24]} /><meshStandardMaterial color={GRAPHITE} roughness={0.4} /></mesh>
        <object3D ref={nozzle} position={[0, -1.38, 0]} />
      </group>
      <Particles active={() => working && drive.speed > 0.6} count={70} color="#8fb3e8" size={0.2} spread={0.8} life={0.9} gravity={1.4} additive={false} maxOpacity={0.45}
        origin={() => (nozzle.current ? nozzle.current.getWorldPosition(tmp) : tmp)} />
    </>
  )
}

function BoothLight({ x, working }: { x: number; working: boolean }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null)
  useFrame((_, dt) => { if (mat.current) mat.current.emissiveIntensity = damp(mat.current.emissiveIntensity, working ? 1.4 : 0.25, 3, dt) })
  return <mesh position={[x, 4.08, 0]}><boxGeometry args={[1.6, 0.03, 5]} /><meshStandardMaterial ref={mat} color="#ffffff" emissive="#ffffff" emissiveIntensity={0.25} toneMapped={false} /></mesh>
}

export function PaintBooth({ working }: { working: boolean }) {
  const posts: [number, number][] = [[-4.5, -3], [4.5, -3], [-4.5, 3], [4.5, 3]]
  return (
    <group>
      {/* стекло камеры: чистое, едва заметное — видно, что внутри */}
      <mesh position={[0, 2.1, 0]}>
        <boxGeometry args={[9, 4, 6]} />
        <meshStandardMaterial color="#e8f1fb" roughness={0.05} metalness={0} transparent opacity={0.1} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {posts.map(([x, z]) => <mesh key={`${x}${z}`} position={[x, 2.1, z]} castShadow><boxGeometry args={[0.12, 4.2, 0.12]} /><meshStandardMaterial {...ALU} /></mesh>)}
      <RoundedBox args={[9.3, 0.16, 6.3]} radius={0.06} smoothness={4} position={[0, 4.2, 0]} castShadow><meshStandardMaterial color="#eef0f3" roughness={0.6} metalness={0.05} /></RoundedBox>
      {[-2.2, 0, 2.2].map((x) => <BoothLight key={x} x={x} working={working} />)}
      <SprayArm x={0} z={-1.6} working={working} phase={0} />
      <SprayArm x={0} z={1.6} working={working} phase={1.5} />
    </group>
  )
}

/* ───────────── Конвейер сборки ───────────── */
export function AssemblyLine({ working }: { working: boolean }) {
  const slats = useRef<THREE.Group>(null)
  const workers = useRef<THREE.Group>(null)
  const drive = useMemo(() => new Drive(), [])
  const still = useMemo(reducedMotion, [])
  useFrame(({ clock }, dt) => {
    const before = drive.t
    drive.step(dt, working && !still, 1.8)          // лента разгоняется и тормозит, как настоящая
    const dx = (drive.t - before) * 1.2
    if (slats.current) slats.current.children.forEach((c) => { c.position.x += dx; if (c.position.x > 8) c.position.x -= 16 })
    // рабочие: спокойное движение корпуса, без «болтания»
    if (workers.current) workers.current.children.forEach((w, i) => { w.rotation.y = Math.sin(clock.elapsedTime * 0.9 + i * 1.7) * 0.25 * (0.3 + 0.7 * drive.speed) })
  })
  return (
    <group>
      <RoundedBox args={[16.4, 0.25, 2.4]} radius={0.06} smoothness={4} position={[0, 0.42, 0]} receiveShadow castShadow><meshStandardMaterial color="#4b525b" roughness={0.55} metalness={0.35} /></RoundedBox>
      {[-1.25, 1.25].map((z) => <mesh key={z} position={[0, 0.6, z]}><boxGeometry args={[16.4, 0.1, 0.08]} /><meshStandardMaterial color="#e8b931" roughness={0.5} /></mesh>)}
      <group ref={slats}>
        {Array.from({ length: 24 }, (_, i) => <mesh key={i} position={[-8 + i * (16 / 24), 0.56, 0]}><boxGeometry args={[0.32, 0.03, 2.2]} /><meshStandardMaterial {...ALU} /></mesh>)}
      </group>
      {/* посты с инструментом */}
      {[-6, -2, 2, 6].map((x) => (
        <group key={x} position={[x, 0, -2.5]}>
          <mesh castShadow position={[0, 1.6, 0]}><boxGeometry args={[0.12, 3.2, 0.12]} /><meshStandardMaterial {...ALU} /></mesh>
          <mesh castShadow position={[0, 3.2, 0.9]}><boxGeometry args={[0.1, 0.1, 1.9]} /><meshStandardMaterial {...ALU} /></mesh>
          <mesh position={[0, 2.5, 1.8]}><cylinderGeometry args={[0.01, 0.01, 1.4, 6]} /><meshStandardMaterial color="#111" /></mesh>
          <RoundedBox args={[0.18, 0.3, 0.18]} radius={0.04} position={[0, 1.75, 1.8]} castShadow><meshStandardMaterial color={GRAPHITE} roughness={0.4} /></RoundedBox>
        </group>
      ))}
      {/* рабочие в сигнальных жилетах */}
      <group ref={workers}>
        {[-4, 0, 4].map((x) => (
          <group key={x} position={[x, 0.2, 2.1]}>
            <mesh castShadow position={[0, 0.75, 0]}><capsuleGeometry args={[0.22, 0.7, 8, 16]} /><meshStandardMaterial color="#f28c28" roughness={0.75} /></mesh>
            <mesh castShadow position={[0, 1.5, 0]}><sphereGeometry args={[0.17, 24, 24]} /><meshStandardMaterial color="#e2b993" roughness={0.7} /></mesh>
            <mesh position={[0, 1.62, 0]}><sphereGeometry args={[0.19, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#f5f5f4" roughness={0.4} /></mesh>
          </group>
        ))}
      </group>
    </group>
  )
}

/* ───────────── Арка контроля качества ───────────── */
export function QcArch({ working }: { working: boolean }) {
  const laser = useRef<THREE.Mesh>(null)
  const strips = useRef<THREE.MeshStandardMaterial[]>([])
  const drive = useMemo(() => new Drive(), [])
  const still = useMemo(reducedMotion, [])
  useFrame((_, dt) => {
    const k = drive.step(dt, working && !still, 2.5)
    if (laser.current) {
      // плоскость сканера: плавный проход вперёд-назад с замедлением у краёв
      laser.current.position.x = (easeInOutCubic((Math.sin(k * 1.6) + 1) / 2) * 2 - 1) * 1.8
      ;(laser.current.material as THREE.MeshBasicMaterial).opacity = 0.22 * drive.speed
    }
    strips.current.forEach((m) => m && (m.emissiveIntensity = damp(m.emissiveIntensity, working ? 1.6 : 0.15, 3, dt)))
  })
  return (
    <group>
      {[-1.9, 1.9].map((z) => <RoundedBox key={z} args={[0.4, 3.4, 0.4]} radius={0.1} smoothness={6} position={[0, 1.7, z]} castShadow><meshStandardMaterial color="#f2f3f5" roughness={0.3} /></RoundedBox>)}
      <RoundedBox args={[0.8, 0.4, 4.2]} radius={0.12} smoothness={6} position={[0, 3.4, 0]} castShadow><meshStandardMaterial color="#f2f3f5" roughness={0.3} /></RoundedBox>
      {[-1.7, 1.7].map((z, i) => <mesh key={z} position={[0, 1.7, z * 0.97]}><boxGeometry args={[0.04, 2.8, 0.04]} /><meshStandardMaterial ref={(m) => { if (m) strips.current[i] = m }} color="#7dd3fc" emissive="#7dd3fc" emissiveIntensity={0.15} toneMapped={false} /></mesh>)}
      <mesh ref={laser} position={[0, 1.6, 0]}>
        <boxGeometry args={[0.02, 3, 3.6]} />
        <meshBasicMaterial color="#86efac" transparent opacity={0} toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  )
}

/* ───────────── Стеллажи склада ───────────── */
export function Racks() {
  return (
    <group>
      {[-3.5, 3.5].map((z) => (
        <group key={z} position={[0, 0, z]}>
          {[-3, 3].map((x) => [-0.7, 0.7].map((dz) => <mesh key={`${x}${dz}`} position={[x, 1.4, dz]} castShadow><boxGeometry args={[0.08, 2.8, 0.08]} /><meshStandardMaterial color="#5b6573" roughness={0.5} metalness={0.4} /></mesh>))}
          {[0.15, 1.1, 2.05].map((y) => (
            <group key={y}>
              <mesh position={[0, y, 0]}><boxGeometry args={[6.2, 0.05, 1.5]} /><meshStandardMaterial {...ALU} /></mesh>
              {[-2.1, 0, 2.1].map((x) => <RoundedBox key={x} args={[1.6, 0.6, 1.2]} radius={0.03} position={[x, y + 0.35, 0]} castShadow><meshStandardMaterial color={(x + y) % 2 > 0.5 ? '#cfbb98' : '#d9c8a8'} roughness={0.9} /></RoundedBox>)}
            </group>
          ))}
        </group>
      ))}
    </group>
  )
}
