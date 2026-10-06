// Процедурные 3D-модели оборудования и кузовов: без внешних файлов, лёгкие, работают офлайн.
// Анимация включается только когда участок реально работает (состояние из симуляции).
import { RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

const METAL = { color: '#c9ced6', roughness: 0.35, metalness: 0.6 }
const ROBOT = '#f08a24'
const DARK = '#2b3138'

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
function Particles({ active, count = 90, color, size, spread, life, gravity, origin, additive = true }:
  { active: boolean; count?: number; color: string; size: number; spread: number; life: number; gravity: number; origin: () => THREE.Vector3; additive?: boolean }) {
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
    // источник задан в мировых координатах → переводим в локальные координаты частиц
    const o = pts.current ? pts.current.worldToLocal(loc.copy(origin())) : loc.copy(origin())
    state.forEach((s, i) => {
      s.age += dt
      if (s.age > life) {
        s.age = 0
        if (active) {
          s.p.copy(o)
          s.v.set((Math.random() - 0.5) * spread, Math.random() * spread * 0.8, (Math.random() - 0.5) * spread)
        } else s.p.set(0, -99, 0)
      }
      s.v.y -= gravity * dt
      s.p.addScaledVector(s.v, dt)
      pos.setXYZ(i, s.p.x, s.p.y, s.p.z)
    })
    pos.needsUpdate = true
    if (mat.current) mat.current.opacity = active ? 0.9 : Math.max(0, mat.current.opacity - dt)
  })
  return (
    <points ref={pts} geometry={geo} frustumCulled={false}>
      <pointsMaterial ref={mat} color={color} size={size} transparent opacity={0.9} depthWrite={false} blending={additive ? THREE.AdditiveBlending : THREE.NormalBlending} toneMapped={false} />
    </points>
  )
}

/* ───────────── 6-осевой робот сварки ───────────── */
export function WeldRobot({ x, z, working, phase, flip = false }: { x: number; z: number; working: boolean; phase: number; flip?: boolean }) {
  const turn = useRef<THREE.Group>(null)
  const shoulder = useRef<THREE.Group>(null)
  const elbow = useRef<THREE.Group>(null)
  const wrist = useRef<THREE.Group>(null)
  const tip = useRef<THREE.Object3D>(null)
  const tmp = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ clock }) => {
    const k = working ? clock.elapsedTime * 1.4 + phase : phase
    if (turn.current) turn.current.rotation.y = (flip ? Math.PI : 0) + Math.sin(k * 0.7) * 0.6
    if (shoulder.current) shoulder.current.rotation.z = -0.35 + Math.sin(k) * 0.18
    if (elbow.current) elbow.current.rotation.z = 1.1 + Math.sin(k * 1.3) * 0.22
    if (wrist.current) wrist.current.rotation.z = 0.6 + Math.sin(k * 2.1) * 0.3
  })
  return (
    <group position={[x, 0.2, z]}>
      <mesh castShadow position={[0, 0.18, 0]}><cylinderGeometry args={[0.7, 0.8, 0.36, 32]} /><meshStandardMaterial color={DARK} roughness={0.5} /></mesh>
      <group ref={turn} position={[0, 0.36, 0]}>
        <mesh castShadow position={[0, 0.25, 0]}><cylinderGeometry args={[0.5, 0.55, 0.5, 32]} /><meshStandardMaterial color={ROBOT} roughness={0.4} /></mesh>
        <group ref={shoulder} position={[0, 0.55, 0]}>
          <mesh castShadow rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.28, 0.28, 0.6, 24]} /><meshStandardMaterial color={DARK} /></mesh>
          <RoundedBox args={[0.38, 1.7, 0.38]} radius={0.12} position={[0, 0.85, 0]} castShadow><meshStandardMaterial color={ROBOT} roughness={0.4} /></RoundedBox>
          <group ref={elbow} position={[0, 1.7, 0]}>
            <mesh castShadow rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.22, 0.22, 0.48, 24]} /><meshStandardMaterial color={DARK} /></mesh>
            <RoundedBox args={[0.3, 1.3, 0.3]} radius={0.1} position={[0, 0.65, 0]} castShadow><meshStandardMaterial color={ROBOT} roughness={0.4} /></RoundedBox>
            <group ref={wrist} position={[0, 1.3, 0]}>
              <mesh castShadow><sphereGeometry args={[0.17, 20, 20]} /><meshStandardMaterial color={DARK} /></mesh>
              <mesh castShadow position={[0, 0.3, 0]}><cylinderGeometry args={[0.05, 0.09, 0.5, 12]} /><meshStandardMaterial {...METAL} /></mesh>
              <object3D ref={tip} position={[0, 0.58, 0]} />
            </group>
          </group>
        </group>
      </group>
      {/* искры сварки на кончике горелки */}
      <Particles active={working} color="#ffb547" size={0.09} spread={2.4} life={0.45} gravity={9} origin={() => (tip.current ? tip.current.getWorldPosition(tmp) : tmp.set(0, 2, 0))} />
    </group>
  )
}

/* ───────────── Окрасочная камера ───────────── */
function SprayArm({ x, z, working, phase }: { x: number; z: number; working: boolean; phase: number }) {
  const g = useRef<THREE.Group>(null)
  const nozzle = useRef<THREE.Object3D>(null)
  const tmp = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ clock }) => {
    if (!g.current) return
    const k = working ? clock.elapsedTime * 1.2 + phase : phase
    g.current.position.x = x + Math.sin(k) * 1.6
    g.current.rotation.z = Math.sin(k * 1.7) * 0.25
  })
  return (
    <>
      <group ref={g} position={[x, 3.6, z]}>
        <mesh castShadow position={[0, -0.6, 0]}><cylinderGeometry args={[0.07, 0.07, 1.2, 12]} /><meshStandardMaterial color="#e5e7eb" metalness={0.4} roughness={0.3} /></mesh>
        <mesh position={[0, -1.25, 0]}><coneGeometry args={[0.12, 0.25, 16]} /><meshStandardMaterial color="#9aa3af" /></mesh>
        <object3D ref={nozzle} position={[0, -1.4, 0]} />
      </group>
      <Particles active={working} count={70} color="#7aa7e6" size={0.22} spread={0.9} life={0.9} gravity={1.5} additive={false}
        origin={() => (nozzle.current ? nozzle.current.getWorldPosition(tmp) : tmp)} />
    </>
  )
}

export function PaintBooth({ working }: { working: boolean }) {
  const posts: [number, number][] = [[-4.5, -3], [4.5, -3], [-4.5, 3], [4.5, 3]]
  return (
    <group>
      <mesh position={[0, 2.1, 0]}>
        <boxGeometry args={[9, 4, 6]} />
        <meshStandardMaterial color="#dbeafe" roughness={0.1} metalness={0.1} transparent opacity={0.16} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {posts.map(([x, z]) => <mesh key={`${x}${z}`} position={[x, 2.1, z]} castShadow><boxGeometry args={[0.16, 4.2, 0.16]} /><meshStandardMaterial {...METAL} /></mesh>)}
      <mesh position={[0, 4.2, 0]} castShadow><boxGeometry args={[9.3, 0.2, 6.3]} /><meshStandardMaterial color="#d6dbe2" /></mesh>
      {[-2.2, 0, 2.2].map((x) => <mesh key={x} position={[x, 4.08, 0]}><boxGeometry args={[1.6, 0.04, 5]} /><meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={working ? 1.6 : 0.2} toneMapped={false} /></mesh>)}
      {/* роботы-распылители внутри камеры (мировые координаты для частиц считаются от зоны) */}
      <group position={[0, 0, 0]}>
        <SprayArm x={0} z={-1.6} working={working} phase={0} />
        <SprayArm x={0} z={1.6} working={working} phase={1.5} />
      </group>
    </group>
  )
}

/* ───────────── Конвейер сборки ───────────── */
export function AssemblyLine({ working }: { working: boolean }) {
  const slats = useRef<THREE.Group>(null)
  const workers = useRef<THREE.Group>(null)
  useFrame(({ clock }, dt) => {
    if (slats.current && working) slats.current.children.forEach((c) => { c.position.x += dt * 1.2; if (c.position.x > 8) c.position.x -= 16 })
    if (workers.current) workers.current.children.forEach((w, i) => { w.rotation.y = Math.sin(clock.elapsedTime * (working ? 2 : 0.3) + i) * 0.5 })
  })
  return (
    <group>
      <mesh position={[0, 0.42, 0]} receiveShadow castShadow><boxGeometry args={[16.4, 0.25, 2.4]} /><meshStandardMaterial color="#5b6470" roughness={0.6} metalness={0.3} /></mesh>
      {[-1.25, 1.25].map((z) => <mesh key={z} position={[0, 0.62, z]}><boxGeometry args={[16.4, 0.14, 0.1]} /><meshStandardMaterial color="#facc15" roughness={0.5} /></mesh>)}
      <group ref={slats}>
        {Array.from({ length: 24 }, (_, i) => <mesh key={i} position={[-8 + i * (16 / 24), 0.56, 0]}><boxGeometry args={[0.32, 0.03, 2.2]} /><meshStandardMaterial color="#8b939e" metalness={0.5} roughness={0.4} /></mesh>)}
      </group>
      {/* посты с инструментом */}
      {[-6, -2, 2, 6].map((x) => (
        <group key={x} position={[x, 0, -2.5]}>
          <mesh castShadow position={[0, 1.6, 0]}><boxGeometry args={[0.14, 3.2, 0.14]} /><meshStandardMaterial {...METAL} /></mesh>
          <mesh castShadow position={[0, 3.2, 0.9]}><boxGeometry args={[0.12, 0.12, 1.9]} /><meshStandardMaterial {...METAL} /></mesh>
          <mesh position={[0, 2.5, 1.8]}><cylinderGeometry args={[0.01, 0.01, 1.4, 6]} /><meshStandardMaterial color="#111" /></mesh>
          <mesh castShadow position={[0, 1.75, 1.8]}><boxGeometry args={[0.18, 0.3, 0.18]} /><meshStandardMaterial color="#334155" /></mesh>
        </group>
      ))}
      {/* рабочие в жилетах */}
      <group ref={workers}>
        {[-4, 0, 4].map((x) => (
          <group key={x} position={[x, 0.2, 2.1]}>
            <mesh castShadow position={[0, 0.75, 0]}><capsuleGeometry args={[0.22, 0.7, 6, 12]} /><meshStandardMaterial color="#f97316" roughness={0.7} /></mesh>
            <mesh castShadow position={[0, 1.5, 0]}><sphereGeometry args={[0.17, 16, 16]} /><meshStandardMaterial color="#e2b993" /></mesh>
            <mesh position={[0, 1.62, 0]}><sphereGeometry args={[0.19, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#fde047" /></mesh>
          </group>
        ))}
      </group>
    </group>
  )
}

/* ───────────── Арка контроля качества ───────────── */
export function QcArch({ working }: { working: boolean }) {
  const laser = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!laser.current) return
    laser.current.visible = working
    laser.current.position.x = Math.sin(clock.elapsedTime * 2.2) * 1.8
  })
  return (
    <group>
      {[-1.9, 1.9].map((z) => <RoundedBox key={z} args={[0.4, 3.4, 0.4]} radius={0.08} position={[0, 1.7, z]} castShadow><meshStandardMaterial color="#e5e7eb" roughness={0.3} /></RoundedBox>)}
      <RoundedBox args={[0.8, 0.4, 4.2]} radius={0.1} position={[0, 3.4, 0]} castShadow><meshStandardMaterial color="#e5e7eb" roughness={0.3} /></RoundedBox>
      {[-1.7, 1.7].map((z) => <mesh key={z} position={[0, 1.7, z * 0.97]}><boxGeometry args={[0.05, 2.8, 0.05]} /><meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={working ? 2 : 0.2} toneMapped={false} /></mesh>)}
      <mesh ref={laser} position={[0, 1.6, 0]}>
        <boxGeometry args={[0.04, 3, 3.6]} />
        <meshBasicMaterial color="#22c55e" transparent opacity={0.35} toneMapped={false} depthWrite={false} />
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
          {[-3, 3].map((x) => [-0.7, 0.7].map((dz) => <mesh key={`${x}${dz}`} position={[x, 1.4, dz]} castShadow><boxGeometry args={[0.1, 2.8, 0.1]} /><meshStandardMaterial color="#3b82f6" /></mesh>))}
          {[0.15, 1.1, 2.05].map((y) => (
            <group key={y}>
              <mesh position={[0, y, 0]}><boxGeometry args={[6.2, 0.06, 1.5]} /><meshStandardMaterial color="#f97316" /></mesh>
              {[-2.1, 0, 2.1].map((x) => <mesh key={x} position={[x, y + 0.35, 0]} castShadow><boxGeometry args={[1.6, 0.6, 1.2]} /><meshStandardMaterial color={(x + y) % 2 > 0.5 ? '#cdb791' : '#d8c6a3'} roughness={0.85} /></mesh>)}
            </group>
          ))}
        </group>
      ))}
    </group>
  )
}
