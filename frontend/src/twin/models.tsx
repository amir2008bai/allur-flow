// Процедурные 3D-модели оборудования и кузовов: без внешних файлов, лёгкие, работают офлайн.
// Анимация включается только когда участок реально работает (состояние из симуляции).
import { RoundedBox } from '@react-three/drei'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Drive, clamp01, damp, easeInOutCubic } from './motion'
import { useMotionFrame } from './SceneMotion'
import { WELD_SEAMS, weldPose, type Point3 } from './kinematics'

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

export function Sedan({ position, color = '#f7f8fa', scale = 1, rotY = Math.PI / 2, wheels = true, unfinished = false }: { position: [number, number, number]; color?: string; scale?: number; rotY?: number; wheels?: boolean; unfinished?: boolean }) {
  return (
    <group position={position} scale={scale} rotation={[0, rotY, 0]}>
      <mesh castShadow><primitive object={sedanGeo} attach="geometry" /><meshStandardMaterial color={color} roughness={unfinished ? 0.5 : 0.3} metalness={0.35} /></mesh>
      {!unfinished && <mesh><primitive object={glassGeo} attach="geometry" /><meshStandardMaterial color="#1e2833" roughness={0.15} metalness={0.55} /></mesh>}
      {wheels && !unfinished && [[-0.52, 0.38], [0.52, 0.38], [-0.52, -0.38], [0.52, -0.38]].map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x, 0.15, z]}><primitive object={wheelGeo} attach="geometry" /><meshStandardMaterial color="#1b1f24" roughness={0.8} /></mesh>
      ))}
    </group>
  )
}

/* ───────────── Искры / туман: частицы ───────────── */
type Flag = boolean | (() => boolean)
const on = (f: Flag) => (typeof f === 'function' ? f() : f)

function Particles({ active, enabled = true, count = 90, color, size, spread, life, gravity, origin, additive = true, maxOpacity = 0.9 }:
  { active: Flag; enabled?: boolean; count?: number; color: string; size: number; spread: number; life: number; gravity: number; origin: () => THREE.Vector3; additive?: boolean; maxOpacity?: number }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    return g
  }, [count])
  const state = useMemo(() => Array.from({ length: count }, () => ({ p: new THREE.Vector3(0, -99, 0), v: new THREE.Vector3(), age: Math.random() * life })), [count, life])
  const mat = useRef<THREE.PointsMaterial>(null)
  const pts = useRef<THREE.Points>(null)
  const loc = useMemo(() => new THREE.Vector3(), [])
  useEffect(() => () => geo.dispose(), [geo])
  useMotionFrame(({ dt, reduced }) => {
    if (reduced) { if (mat.current) mat.current.opacity = 0; return }
    if (!dt) return
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
    <points ref={pts} geometry={geo} visible={enabled} frustumCulled={false}>
      <pointsMaterial ref={mat} color={color} size={size} transparent opacity={0} depthWrite={false} blending={additive ? THREE.AdditiveBlending : THREE.NormalBlending} toneMapped={false} />
    </points>
  )
}

/* ───────────── Стилизованный робот сварки (ABB: белый корпус, графитовые узлы) ─────────────
 * Работает как настоящий: переезд к точке шва (плавно), пауза-сварка со вспышкой и искрами, следующая точка.
 * При остановке гасит дугу, замедляет привод и остаётся у точки; пауза замораживает всё. */
const MOVE = 1.25, DWELL = 0.9

export function WeldRobot({ x, z, working, phase, flip = false }: { x: number; z: number; working: boolean; phase: number; flip?: boolean }) {
  const turn = useRef<THREE.Group>(null)
  const shoulder = useRef<THREE.Group>(null)
  const elbow = useRef<THREE.Group>(null)
  const wrist = useRef<THREE.Group>(null)
  const tip = useRef<THREE.Object3D>(null)
  const glow = useRef<THREE.Mesh>(null)
  const tmp = useMemo(() => new THREE.Vector3(), [])
  const seams = useMemo(() => WELD_SEAMS.map(([a, b, c]) => [flip ? -a : a, b, flip ? -c : c] as Point3), [flip])
  const initial = useMemo(() => weldPose(x, z, seams[0]), [x, z, seams])
  const welding = useRef(false)
  const drive = useMemo(() => new Drive(phase), [phase])
  useMotionFrame(({ dt, reduced }) => {
    if (!working) { welding.current = false; if (glow.current) (glow.current.material as THREE.MeshBasicMaterial).opacity = 0 }
    if (reduced) { welding.current = false; if (glow.current) (glow.current.material as THREE.MeshBasicMaterial).opacity = 0; return }
    if (!dt) return
    welding.current = false
    const t = drive.step(dt, working, working ? 3.5 : 7)
    const step = MOVE + DWELL
    const i = Math.floor(t / step), local = t - i * step
    const a = seams[i % seams.length], b = seams[(i + 1) % seams.length]
    const k = easeInOutCubic(clamp01(local / MOVE))
    const target = a.map((v, j) => v + (b[j] - v) * k) as [number, number, number]
    target[1] += local < MOVE ? Math.sin(Math.PI * k) * 0.18 : 0
    welding.current = working && drive.speed > 0.9 && local > MOVE + 0.08 && local < step - 0.05
    const [r, s, e, w] = weldPose(x, z, target)
    if (turn.current) turn.current.rotation.y = r
    if (shoulder.current) shoulder.current.rotation.z = s
    if (elbow.current) elbow.current.rotation.z = e
    if (wrist.current) wrist.current.rotation.z = w
    if (glow.current) {
      const m = glow.current.material as THREE.MeshBasicMaterial
      m.opacity = welding.current ? 0.82 : 0
    }
  })
  return (
    <group position={[x, 0.2, z]}>
      <mesh castShadow position={[0, 0.16, 0]}><cylinderGeometry args={[0.62, 0.7, 0.32, 48]} /><meshStandardMaterial color={GRAPHITE} roughness={0.55} metalness={0.2} /></mesh>
      <group ref={turn} position={[0, 0.32, 0]} rotation={[0, initial[0], 0]}>
        <mesh castShadow position={[0, 0.24, 0]}><cylinderGeometry args={[0.46, 0.5, 0.48, 48]} /><meshStandardMaterial {...ROBOT_SHELL} /></mesh>
        <group ref={shoulder} position={[0, 0.55, 0]} rotation={[0, 0, initial[1]]}>
          <mesh castShadow rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.27, 0.27, 0.62, 32]} /><meshStandardMaterial color={GRAPHITE} roughness={0.45} metalness={0.3} /></mesh>
          <RoundedBox args={[0.36, 1.7, 0.36]} radius={0.15} smoothness={6} position={[0, 0.85, 0]} castShadow><meshStandardMaterial {...ROBOT_SHELL} /></RoundedBox>
          <mesh position={[-0.22, 0.85, 0]}><boxGeometry args={[0.045, 1.3, 0.12]} /><meshStandardMaterial color={GRAPHITE} /></mesh>
          <group ref={elbow} position={[0, 1.7, 0]} rotation={[0, 0, initial[2]]}>
            <mesh castShadow rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.21, 0.21, 0.5, 32]} /><meshStandardMaterial color={GRAPHITE} roughness={0.45} metalness={0.3} /></mesh>
            <RoundedBox args={[0.28, 1.3, 0.28]} radius={0.12} smoothness={6} position={[0, 0.65, 0]} castShadow><meshStandardMaterial {...ROBOT_SHELL} /></RoundedBox>
            <mesh position={[-0.18, 0.65, 0]}><boxGeometry args={[0.04, 0.95, 0.1]} /><meshStandardMaterial color={GRAPHITE} /></mesh>
            <group ref={wrist} position={[0, 1.3, 0]} rotation={[0, 0, initial[3]]}>
              <mesh castShadow><sphereGeometry args={[0.16, 32, 32]} /><meshStandardMaterial color={GRAPHITE} roughness={0.4} metalness={0.3} /></mesh>
              <mesh castShadow position={[0, 0.3, 0]}><cylinderGeometry args={[0.045, 0.085, 0.5, 24]} /><meshStandardMaterial {...METAL} /></mesh>
              <object3D ref={tip} position={[0, 0.58, 0]} />
              {/* вспышка дуги: маленькое тёплое ядро, только во время сварки */}
              <mesh ref={glow} position={[0, 0.58, 0]}>
                <sphereGeometry args={[0.065, 12, 12]} />
                <meshBasicMaterial color="#fff1d6" transparent opacity={0} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
              </mesh>
            </group>
          </group>
        </group>
      </group>
      {/* искры: короткие, тёплые, только в момент сварки */}
      <Particles enabled={working} active={() => working && welding.current} count={24} color="#ffc773" size={0.045} spread={1.1} life={0.22} gravity={9} maxOpacity={0.6}
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
  useMotionFrame(({ dt }) => {
    if (!g.current) return
    if (!dt) return
    const k = drive.step(dt, working, 5) * 0.65
    // проход вдоль кузова: плавный разворот у краёв (как реальный покрасочный робот)
    const sweep = easeInOutCubic((Math.sin(k) + 1) / 2) * 2 - 1
    g.current.position.x = x + sweep * 1.6
    g.current.rotation.z = -sweep * 0.12
  })
  return (
    <>
      <group ref={g} position={[x, 3.3, z]}>
        <mesh castShadow position={[0, -0.6, 0]}><cylinderGeometry args={[0.06, 0.06, 1.2, 24]} /><meshStandardMaterial {...ROBOT_SHELL} /></mesh>
        <mesh position={[0, -1.24, 0]}><coneGeometry args={[0.1, 0.22, 24]} /><meshStandardMaterial color={GRAPHITE} roughness={0.4} /></mesh>
        <object3D ref={nozzle} position={[0, -1.38, 0]} />
      </group>
      <Particles enabled={working} active={() => working && drive.speed > 0.6} count={32} color="#8fb3e8" size={0.12} spread={0.45} life={0.6} gravity={1.8} additive={false} maxOpacity={0.3}
        origin={() => (nozzle.current ? nozzle.current.getWorldPosition(tmp) : tmp)} />
    </>
  )
}

function BoothLight({ x, working }: { x: number; working: boolean }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null)
  const previous = useRef<boolean | null>(null)
  useMotionFrame(({ dt, frozen }) => {
    if (!mat.current || (frozen && previous.current === working)) return
    previous.current = working
    mat.current.emissiveIntensity = frozen ? (working ? 1.0 : 0.25) : damp(mat.current.emissiveIntensity, working ? 1.0 : 0.25, 3, dt)
  })
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
      {[-3, 3].map((z) => <RoundedBox key={z} args={[9.3, 0.16, 0.18]} radius={0.05} smoothness={3} position={[0, 4.2, z]} castShadow><meshStandardMaterial {...ALU} /></RoundedBox>)}
      {[-4.5, 4.5].map((x) => <RoundedBox key={x} args={[0.18, 0.16, 6.3]} radius={0.05} smoothness={3} position={[x, 4.2, 0]} castShadow><meshStandardMaterial {...ALU} /></RoundedBox>)}
      {[-3.6, 3.6].map((x) => <group key={x} position={[x, 4.25, 0]}>
        <RoundedBox args={[1.1, 0.3, 5.6]} radius={0.06} smoothness={3} castShadow><meshStandardMaterial color="#f1f3f5" roughness={0.7} /></RoundedBox>
        {[-2, -1, 0, 1, 2].map((z) => <mesh key={z} position={[0, 0.16, z]}><boxGeometry args={[0.75, 0.015, 0.06]} /><meshStandardMaterial color="#b5bec9" /></mesh>)}
      </group>)}
      {[-2.2, 0, 2.2].map((x) => <BoothLight key={x} x={x} working={working} />)}
      <SprayArm x={0} z={-0.5} working={working} phase={0} />
      <SprayArm x={0} z={0.5} working={working} phase={1.5} />
    </group>
  )
}

/* ───────────── Конвейер сборки ───────────── */
export function AssemblyLine({ working, hasBody }: { working: boolean; hasBody: boolean }) {
  const slats = useRef<THREE.Group>(null)
  const workers = useRef<THREE.Group>(null)
  const body = useRef<THREE.Group>(null)
  const visibility = useRef(hasBody ? 1 : 0)
  const drive = useMemo(() => new Drive(5.25), [])
  useMotionFrame(({ dt }) => {
    if (!dt) return
    const before = drive.t
    drive.step(dt, working, 5)
    const dx = (drive.t - before) * 1.2
    if (slats.current) slats.current.children.forEach((c) => { c.position.x += dx; if (c.position.x > 8) c.position.x -= 16 })
    if (body.current) {
      const p = ((drive.t * 1.2) % 12.6) / 12.6
      body.current.position.x = -6.3 + p * 12.6
      visibility.current = damp(visibility.current, hasBody ? 1 : 0, 10, dt)
      const edge = Math.min(1, p / 0.08, (1 - p) / 0.08)
      const opacity = visibility.current * edge
      body.current.visible = opacity > 0.01
      body.current.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        const materials = Array.isArray(o.material) ? o.material : [o.material]
        materials.forEach((m) => {
          const transparent = opacity < 1
          if (m.transparent !== transparent) { m.transparent = transparent; m.needsUpdate = true }
          m.opacity = opacity
        })
      })
    }
    if (workers.current) workers.current.children.forEach((w, i) => { w.rotation.y = Math.sin(drive.t * 0.7 + i * 1.7) * 0.12 })
  })
  return (
    <group>
      <RoundedBox args={[16.4, 0.25, 2.4]} radius={0.06} smoothness={4} position={[0, 0.42, 0]} receiveShadow castShadow><meshStandardMaterial color="#4b525b" roughness={0.55} metalness={0.35} /></RoundedBox>
      {[-1.25, 1.25].map((z) => <mesh key={z} position={[0, 0.6, z]}><boxGeometry args={[16.4, 0.1, 0.08]} /><meshStandardMaterial color="#e8b931" roughness={0.5} /></mesh>)}
      <group ref={slats}>
        {Array.from({ length: 24 }, (_, i) => <mesh key={i} position={[-8 + i * (16 / 24), 0.56, 0]}><boxGeometry args={[0.32, 0.03, 2.2]} /><meshStandardMaterial {...ALU} /></mesh>)}
      </group>
      <group ref={body} visible={hasBody}>
        <Sedan position={[0, 0.64, 0]} rotY={0} scale={2.2} color="#3b5b8c" />
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
  const previous = useRef<boolean | null>(null)
  useMotionFrame(({ dt, frozen }) => {
    if (frozen && previous.current === working) return
    previous.current = working
    const k = drive.step(dt, working, 5)
    if (laser.current) {
      // плоскость сканера: плавный проход вперёд-назад с замедлением у краёв
      laser.current.position.x = (easeInOutCubic((Math.sin(k * 1.6) + 1) / 2) * 2 - 1) * 1.8
      ;(laser.current.material as THREE.MeshBasicMaterial).opacity = working ? 0.22 * (frozen ? 0.55 : drive.speed) : 0
    }
    strips.current.forEach((m) => m && (m.emissiveIntensity = frozen ? (working ? 1.0 : 0.15) : damp(m.emissiveIntensity, working ? 1.0 : 0.15, 3, dt)))
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
