import { Environment, Html, Lightformer, Line, OrbitControls, RoundedBox } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useReducedMotion } from '../twin/motionPreference'
import { COMPS, COMP_BY, LAYERS, STATUS_RU, type Comp } from './model'

const GAP_Y = 2.4          // расстояние между слоями
const STEP_X = 3.4         // между блоками на слое
const SLAB_W = Math.max(...LAYERS.map((l) => COMPS.filter((c) => c.layer === l.id).length)) * STEP_X + 5.6   // слева — место под подпись слоя

/** Позиции блоков: слой — по высоте, блоки слоя — в ряд по центру. */
function usePositions() {
  return useMemo(() => {
    const pos: Record<string, THREE.Vector3> = {}
    LAYERS.forEach((l, i) => {
      const list = COMPS.filter((c) => c.layer === l.id)
      list.forEach((c, j) => { pos[c.id] = new THREE.Vector3((j - (list.length - 1) / 2) * STEP_X + 1.6, i * GAP_Y, 0) })
    })
    return pos
  }, [])
}

interface Flow { from: string; to: string; curve: THREE.QuadraticBezierCurve3; hex: string }

function useFlows(pos: Record<string, THREE.Vector3>): Flow[] {
  return useMemo(() => COMPS.flatMap((c) => (c.to ?? []).filter((t) => COMP_BY[t]).map((t) => {
    const a = pos[c.id].clone().add(new THREE.Vector3(0, 0.35, 0))
    const b = pos[t].clone().add(new THREE.Vector3(0, -0.05, 0))
    const same = Math.abs(a.y - b.y) < 0.5
    const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, same ? 1.1 : 0.2, same ? 1.6 : 0.9))
    return { from: c.id, to: t, curve: new THREE.QuadraticBezierCurve3(a, mid, b), hex: LAYERS.find((l) => l.id === c.layer)!.hex }
  })), [pos])
}

/** Частицы данных: по одной на связь, бегут от источника к получателю. */
function Particles({ flows, selected, still }: { flows: Flow[]; selected: string | null; still: boolean }) {
  const refs = useRef<(THREE.Mesh | null)[]>([])
  const p = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ clock }) => {
    const t0 = still ? 0.5 : clock.getElapsedTime() * 0.35
    flows.forEach((f, i) => {
      const m = refs.current[i]
      if (!m) return
      f.curve.getPoint(((t0 + i * 0.137) % 1 + 1) % 1, p)
      m.position.copy(p)
    })
  })
  return (
    <>
      {flows.map((f, i) => {
        const on = !selected || f.from === selected || f.to === selected
        return (
          <mesh key={`${f.from}-${f.to}`} ref={(m) => { refs.current[i] = m }} visible={on}>
            <sphereGeometry args={[0.09, 12, 12]} />
            <meshBasicMaterial color={f.hex} />
          </mesh>
        )
      })}
    </>
  )
}

function Block({ c, at, selected, dim, onSelect }: { c: Comp; at: THREE.Vector3; selected: boolean; dim: boolean; onSelect: (id: string) => void }) {
  const [hover, setHover] = useState(false)
  const layer = LAYERS.find((l) => l.id === c.layer)!
  const plan = c.status === 'plan'
  return (
    <group position={at}>
      <RoundedBox args={[2.8, 0.42, 1.2]} radius={0.12} smoothness={4} position={[0, 0.21, 0]}
        onClick={(e) => { e.stopPropagation(); onSelect(c.id) }}
        onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { setHover(false); document.body.style.cursor = '' }}>
        <meshStandardMaterial color={plan ? '#ffffff' : layer.hex} transparent opacity={dim ? 0.25 : plan ? 0.55 : 0.92}
          roughness={0.35} metalness={0.05} emissive={layer.hex} emissiveIntensity={selected || hover ? 0.35 : 0} />
      </RoundedBox>
      {plan && <lineSegments position={[0, 0.21, 0]}><edgesGeometry args={[new THREE.BoxGeometry(2.8, 0.42, 1.2)]} /><lineBasicMaterial color="#94a3b8" /></lineSegments>}
      <Html position={[0, 0.62, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none', opacity: dim ? 0.35 : 1 }}>
        <div className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-medium shadow-sm ring-1 ${selected ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white/90 text-slate-800 ring-black/5'}`}>
          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: STATUS_RU[c.status].hex }} />{c.short}
        </div>
      </Html>
    </group>
  )
}

function Scene({ selected, onSelect, still, sway }: { selected: string | null; onSelect: (id: string | null) => void; still: boolean; sway: boolean }) {
  const pos = usePositions()
  const root = useRef<THREE.Group>(null)
  // плавное покачивание вместо полного оборота: подписи не перекрываются, схема всегда читается спереди
  useFrame(({ clock }, dt) => {
    if (!root.current) return
    const target = sway ? Math.sin(clock.getElapsedTime() * 0.25) * 0.28 : 0
    root.current.rotation.y += (target - root.current.rotation.y) * Math.min(1, dt * 2)
  })
  const flows = useFlows(pos)
  const linked = useMemo(() => {
    if (!selected) return null
    const s = new Set([selected])
    flows.forEach((f) => { if (f.from === selected) s.add(f.to); if (f.to === selected) s.add(f.from) })
    return s
  }, [selected, flows])
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[8, 18, 10]} intensity={0.9} />
      <Environment resolution={128}>
        <Lightformer intensity={0.8} position={[0, 30, 0]} rotation-x={Math.PI / 2} scale={[60, 20, 1]} />
        <Lightformer intensity={0.5} position={[-30, 10, 20]} rotation-y={Math.PI / 2} scale={[30, 10, 1]} />
      </Environment>
      <group ref={root}><group position={[0, -LAYERS.length * GAP_Y / 2 + 1.9, 0]}>
        {/* самая первая подпись Html в сцене иногда монтируется пустой (StrictMode + drei Html) — пустая заглушка берёт это на себя */}
        <Html position={[0, -100, 0]} style={{ display: 'none' }}><span /></Html>
        {LAYERS.map((l, i) => (
          <group key={l.id} position={[0, i * GAP_Y, 0]}>
            <RoundedBox args={[SLAB_W, 0.12, 3.2]} radius={0.06} smoothness={4} position={[0, -0.08, 0]} onClick={(e) => { e.stopPropagation(); onSelect(null) }}>
              <meshStandardMaterial color="#ffffff" transparent opacity={0.72} roughness={0.2} />
            </RoundedBox>
            <mesh position={[0, -0.08, 1.61]}><boxGeometry args={[SLAB_W - 0.2, 0.12, 0.02]} /><meshBasicMaterial color={l.hex} /></mesh>
            <Html position={[-SLAB_W / 2 + 0.35, 0.02, 1.0]} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
              <div className="-translate-y-full whitespace-nowrap rounded-md bg-white/80 px-1.5 py-0.5 text-[11px] font-semibold" style={{ color: l.hex }}>{l.name}</div>
            </Html>
          </group>
        ))}
        {flows.map((f) => {
          const on = !selected || f.from === selected || f.to === selected
          return <Line key={`l-${f.from}-${f.to}`} points={f.curve.getPoints(24)} color={on && selected ? f.hex : '#94a3b8'} lineWidth={on && selected ? 2 : 1} transparent opacity={on ? 0.75 : 0.12} />
        })}
        <Particles flows={flows} selected={selected} still={still} />
        {COMPS.map((c) => <Block key={c.id} c={c} at={pos[c.id]} selected={selected === c.id} dim={!!linked && !linked.has(c.id)} onSelect={onSelect} />)}
      </group></group>
    </>
  )
}

/** Отодвинуть камеру под ширину окна: на узком экране вся стопка слоёв помещается целиком. */
function Fit() {
  const { camera, size } = useThree()
  useEffect(() => {
    const aspect = size.width / size.height
    const dist = 24 * Math.max(1, 1.6 / aspect)
    camera.position.setLength(dist)
    camera.updateProjectionMatrix()
  }, [camera, size])
  return null
}

/** Архитектура в 3D: слои снизу вверх (завод → экраны), блоки на слоях, по связям бегут данные. */
export default function Arch3D({ selected, onSelect, height = 520 }: { selected: string | null; onSelect: (id: string | null) => void; height?: number }) {
  const reduce = useReducedMotion()
  const [interacting, setInteracting] = useState(false)
  return (
    <div style={{ height }} className="overflow-hidden rounded-2xl bg-[#f5f6f8]">
      <Canvas frameloop={reduce ? 'demand' : 'always'} dpr={[1, 2]} camera={{ position: [0, 9, 24], fov: 36 }} onPointerMissed={() => onSelect(null)}>
        <color attach="background" args={['#f5f6f8']} />
        <Fit />
        <Scene selected={selected} onSelect={onSelect} still={reduce} sway={!reduce && !interacting && !selected} />
        <OrbitControls makeDefault enablePan={false} minDistance={14} maxDistance={48} minPolarAngle={0.35} maxPolarAngle={1.45}
          onStart={() => setInteracting(true)} onEnd={() => setTimeout(() => setInteracting(false), 4000)} />
      </Canvas>
    </div>
  )
}
