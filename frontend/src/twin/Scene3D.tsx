import { CameraControls, ContactShadows, Environment, Lightformer, RoundedBox } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { EffectComposer, N8AO, SMAA } from '@react-three/postprocessing'
import React, { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { SimRun } from '../source'
import { BUFFERS, STATE_HEX, STATE_RU, ZONES, ZONE_BY_ID, ZONE_BY_STATION, type StationState, type Zone, type ZoneId } from './layout'
import { useView } from './store'

type Frame = SimRun['frames'][number]

const BODY_COLOR = '#f7f8fa'
const PAINTED = '#3b5b8c'

function CarBody({ position, color = BODY_COLOR, scale = 1, rotY = Math.PI / 2 }: { position: [number, number, number]; color?: string; scale?: number; rotY?: number }) {
  return (
    <group position={position} scale={scale} rotation={[0, rotY, 0]}>
      <RoundedBox args={[1.6, 0.42, 0.78]} radius={0.12} position={[0, 0.3, 0]} castShadow>
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.1} />
      </RoundedBox>
      <RoundedBox args={[0.85, 0.34, 0.7]} radius={0.12} position={[-0.08, 0.62, 0]} castShadow>
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.1} />
      </RoundedBox>
    </group>
  )
}

function Beacon({ state, y }: { state: StationState; y: number }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null)
  useFrame(({ clock }) => {
    if (!mat.current) return
    mat.current.emissiveIntensity = state === 'down' ? 1.5 + Math.sin(clock.elapsedTime * 6) * 1.2 : state === 'blocked' ? 1.2 : 0.2
  })
  return (
    <mesh position={[0, y, 0]}>
      <cylinderGeometry args={[0.28, 0.28, 0.5, 24]} />
      <meshStandardMaterial ref={mat} color={STATE_HEX[state]} emissive={STATE_HEX[state]} toneMapped={false} />
    </mesh>
  )
}

function RobotArm({ x, z, working, phase }: { x: number; z: number; working: boolean; phase: number }) {
  const arm = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!arm.current) return
    const k = working ? clock.elapsedTime * 1.6 + phase : phase
    arm.current.rotation.y = Math.sin(k) * 0.9
    arm.current.children[1].rotation.z = -0.6 + Math.sin(k * 1.3) * 0.25
  })
  return (
    <group position={[x, 0.2, z]}>
      <mesh castShadow position={[0, 0.3, 0]}><cylinderGeometry args={[0.55, 0.7, 0.6, 32]} /><meshStandardMaterial color="#d9dde3" roughness={0.5} /></mesh>
      <group ref={arm} position={[0, 0.6, 0]}>
        <mesh castShadow position={[0, 0.9, 0]}><boxGeometry args={[0.45, 1.8, 0.45]} /><meshStandardMaterial color="#f08a24" roughness={0.45} /></mesh>
        <group position={[0, 1.75, 0]}>
          <mesh castShadow position={[0.85, 0, 0]}><boxGeometry args={[1.7, 0.35, 0.35]} /><meshStandardMaterial color="#f08a24" roughness={0.45} /></mesh>
        </group>
      </group>
    </group>
  )
}

function Equipment({ zone, state }: { zone: Zone; state: StationState | null }) {
  const working = state === 'working'
  switch (zone.id) {
    case 'welding':
      return <>
        <RobotArm x={-2.6} z={-2.4} working={working} phase={0} />
        <RobotArm x={2.6} z={2.4} working={working} phase={1.7} />
      </>
    case 'paint':
      return (
        <group>
          <mesh position={[0, 2.1, 0]} castShadow>
            <boxGeometry args={[9, 4, 6]} />
            <meshPhysicalMaterial color="#dfe6ef" roughness={0.15} transmission={0.6} thickness={0.5} transparent opacity={0.55} />
          </mesh>
          <mesh position={[0, 4.15, 0]}><boxGeometry args={[9.2, 0.15, 6.2]} /><meshStandardMaterial color="#c8ced8" /></mesh>
          <mesh position={[0, 4.0, 0]}><boxGeometry args={[7, 0.06, 0.4]} /><meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={working ? 2 : 0.3} toneMapped={false} /></mesh>
        </group>
      )
    case 'assembly':
      return (
        <group>
          <mesh position={[0, 0.45, 0]} receiveShadow castShadow><boxGeometry args={[16, 0.3, 2.2]} /><meshStandardMaterial color="#9aa3af" roughness={0.6} /></mesh>
          {[-6, -2, 2, 6].map((x) => (
            <mesh key={x} position={[x, 1.6, -2.4]} castShadow><boxGeometry args={[1.2, 3, 0.25]} /><meshStandardMaterial color="#d9dde3" /></mesh>
          ))}
        </group>
      )
    case 'qc':
      return (
        <group>
          {[-1.8, 1.8].map((z) => <mesh key={z} position={[0, 1.6, z]} castShadow><boxGeometry args={[0.3, 3.2, 0.3]} /><meshStandardMaterial color="#d9dde3" /></mesh>)}
          <mesh position={[0, 3.3, 0]} castShadow><boxGeometry args={[0.6, 0.3, 4]} /><meshStandardMaterial color="#d9dde3" /></mesh>
          <mesh position={[0, 3.12, 0]}><boxGeometry args={[0.4, 0.05, 3.6]} /><meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={working ? 2.5 : 0.3} toneMapped={false} /></mesh>
        </group>
      )
    default:
      return (
        <group>
          {[-2.5, 0, 2.5].map((x) => [-3.5, 3.5].map((z) => (
            <group key={`${x}${z}`} position={[x, 0, z]}>
              {[0.5, 1.3, 2.1].map((y) => <mesh key={y} position={[0, y, 0]} castShadow><boxGeometry args={[1.8, 0.6, 1.4]} /><meshStandardMaterial color={y === 1.3 ? '#cdb791' : '#d8c6a3'} roughness={0.8} /></mesh>)}
            </group>
          )))}
        </group>
      )
  }
}

function ZoneBlock({ zone, frame, bottleneck }: { zone: Zone; frame: Frame | undefined; bottleneck: boolean }) {
  const selected = useView((s) => s.selected === zone.id)
  const select = useView((s) => s.select)
  const state = zone.station && frame ? (frame.states[zone.station] as StationState) : null
  const hasBody = zone.station && state && state !== 'starved'
  return (
    <group position={[zone.x, 0, zone.z]}>
      <RoundedBox args={[zone.w, 0.2, zone.d]} radius={0.08} position={[0, 0.1, 0]} receiveShadow
        onClick={(e) => { e.stopPropagation(); select(selected ? null : zone.id) }}
        onPointerOver={() => (document.body.style.cursor = 'pointer')} onPointerOut={() => (document.body.style.cursor = '')}>
        <meshStandardMaterial color={selected ? '#ffffff' : '#f6f7f9'} roughness={0.85} />
      </RoundedBox>
      {selected && (
        <mesh position={[0, 0.21, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[Math.max(zone.w, zone.d) * 0.62, Math.max(zone.w, zone.d) * 0.64, 64]} />
          <meshBasicMaterial color="#0f172a" />
        </mesh>
      )}
      <Equipment zone={zone} state={state} />
      {hasBody && <CarBody position={[0, zone.id === 'assembly' ? 0.6 : 0.2, 0]} color={zone.id === 'welding' ? '#c9ced6' : PAINTED} />}
      {state && <group position={[zone.w / 2 - 0.6, 0, -zone.d / 2 + 0.6]}>
        <mesh position={[0, 1.1, 0]}><cylinderGeometry args={[0.06, 0.06, 2.2, 8]} /><meshStandardMaterial color="#9aa3af" /></mesh>
        <Beacon state={state} y={2.45} />
      </group>}
      {bottleneck && <BottleneckMarker y={zone.id === 'paint' ? 5.6 : 4.6} />}
    </group>
  )
}

function BottleneckMarker({ y }: { y: number }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!ref.current) return
    ref.current.rotation.y = clock.elapsedTime * 1.5
    ref.current.position.y = y + Math.sin(clock.elapsedTime * 2) * 0.15
  })
  return (
    <mesh ref={ref} position={[0, y, 0]}>
      <octahedronGeometry args={[0.45]} />
      <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={1.2} toneMapped={false} />
    </mesh>
  )
}

function BufferSlots({ buf, level, cap }: { buf: (typeof BUFFERS)[number]; level: number; cap: number }) {
  const cols = 4
  const rows = Math.ceil(cap / cols)
  const slots = useMemo(() => Array.from({ length: cap }, (_, i) => {
    const c = i % cols, r = Math.floor(i / cols)
    return [buf.x + (c - (cols - 1) / 2) * 1.0, 0.05, (r - (rows - 1) / 2) * 1.9] as [number, number, number]
  }), [buf.x, cap, rows])
  const painted = buf.from !== 'welding'
  return (
    <group>
      <mesh position={[buf.x, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[4.4, rows * 1.9 + 0.4]} />
        <meshStandardMaterial color="#e5e8ed" />
      </mesh>
      {slots.map((p, i) => i < level
        ? <CarBody key={i} position={p} scale={0.55} rotY={0} color={painted ? PAINTED : '#c9ced6'} />
        : <mesh key={i} position={[p[0], 0.04, p[2]]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.5, 1.0]} /><meshBasicMaterial color="#d3d8df" /></mesh>)}
    </group>
  )
}

function CameraRig() {
  const ref = useRef<CameraControls>(null)
  const selected = useView((s) => s.selected)
  const size = useThree((s) => s.size)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const cam = c.camera as THREE.PerspectiveCamera
    const aspect = size.width / Math.max(1, size.height)
    const vfov = THREE.MathUtils.degToRad(cam.fov)
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect)
    // что должно поместиться в кадр: вся линия или выбранный участок (+ место под панель справа)
    const z = selected ? ZONE_BY_ID[selected] : null
    const cx = z ? z.x + 9 : 5.5
    const width = z ? Math.max(z.w, z.d) + 34 : 96
    const depth = z ? z.d + 8 : 30
    const dist = Math.max((width / 2) / Math.tan(hfov / 2), (depth / 2) / Math.tan(vfov / 2)) * 1.1
    const polar = selected ? 0.95 : 0.9
    const azim = selected ? 0.3 : 0.12
    const tx = cx, ty = 0, tz = z ? z.z : 0
    c.setLookAt(tx + dist * Math.sin(polar) * Math.sin(azim), ty + dist * Math.cos(polar), tz + dist * Math.sin(polar) * Math.cos(azim), tx, ty, tz, true)
  }, [selected, size.width, size.height])
  return <CameraControls ref={ref} makeDefault minDistance={6} maxDistance={220} maxPolarAngle={Math.PI / 2.15} smoothTime={0.6} />
}

const LABEL_Y: Partial<Record<ZoneId, number>> = { paint: 4.9 }

function LabelProjector({ refs }: { refs: React.MutableRefObject<Record<string, HTMLDivElement | null>> }) {
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera, size }) => {
    for (const z of ZONES) {
      const el = refs.current[z.id]
      if (!el) continue
      v.set(z.x, LABEL_Y[z.id] ?? 3.9, z.z + z.d / 2).project(camera)
      const x = ((v.x + 1) / 2) * size.width
      const y = ((1 - v.y) / 2) * size.height
      el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`
      el.style.visibility = v.z < 1 ? 'visible' : 'hidden'
    }
  })
  return null
}

function ZoneLabels({ frame, refs }: { frame: Frame | undefined; refs: React.MutableRefObject<Record<string, HTMLDivElement | null>> }) {
  const selected = useView((s) => s.selected)
  const select = useView((s) => s.select)
  return (
    <>
      {ZONES.map((z) => {
        const state = z.station && frame ? (frame.states[z.station] as StationState) : null
        return (
          <div key={z.id} ref={(el) => { refs.current[z.id] = el }} style={{ visibility: 'hidden' }}
            className={`pointer-events-none absolute left-0 top-0 ${selected === z.id ? 'opacity-0' : ''}`}>
            <button onClick={() => select(selected === z.id ? null : z.id)}
              className="pointer-events-auto flex cursor-pointer select-none items-center gap-1 whitespace-nowrap rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium text-slate-800 shadow-sm ring-1 ring-slate-200 backdrop-blur hover:bg-white">
              {z.short}
              {state && (state === 'down' || state === 'blocked') && <span className={state === 'down' ? 'text-red-500' : 'text-amber-600'}>· {STATE_RU[state]}</span>}
            </button>
          </div>
        )
      })}
    </>
  )
}

export default function Scene3D({ run, quality = 'high' }: { run: SimRun; quality?: 'high' | 'low' }) {
  const t = useView((s) => s.t)
  const select = useView((s) => s.select)
  const frame = run.frames[Math.min(Math.floor(t), run.frames.length - 1)]
  const bnStation = run.bottleneck.timeline[Math.min(Math.floor(t / 10), run.bottleneck.timeline.length - 1)]?.station
  const bnZone: ZoneId | undefined = bnStation ? ZONE_BY_STATION[bnStation]?.id : undefined
  const caps = run.buffer_cap
  const labelRefs = useRef<Record<string, HTMLDivElement | null>>({})

  return (
    <div className="relative h-full w-full overflow-hidden">
    <Canvas shadows dpr={[1, quality === 'high' ? 2 : 1]} camera={{ position: [2, 42, 46], fov: 35 }} onPointerMissed={() => select(null)}>
      <color attach="background" args={['#e9ecf1']} />
      <fog attach="fog" args={['#e9ecf1', 120, 240]} />
      <ambientLight intensity={0.15} />
      <directionalLight position={[25, 45, 30]} intensity={2.2} castShadow shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-60} shadow-camera-right={60} shadow-camera-top={30} shadow-camera-bottom={-30} />
      <Environment resolution={256}>
        <Lightformer intensity={0.8} position={[0, 30, 0]} rotation-x={Math.PI / 2} scale={[80, 20, 1]} />
        <Lightformer intensity={0.5} position={[-40, 10, 20]} rotation-y={Math.PI / 2} scale={[40, 10, 1]} />
        <Lightformer intensity={0.5} position={[40, 10, -20]} rotation-y={-Math.PI / 2} scale={[40, 10, 1]} />
      </Environment>

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[5, 0, 0]}>
        <planeGeometry args={[600, 400]} />
        <meshStandardMaterial color="#d9dee5" roughness={1} />
      </mesh>
      {/* транспортная линия по маршруту */}
      <mesh position={[5, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[88, 0.35]} /><meshBasicMaterial color="#b8c1cc" /></mesh>

      {ZONES.map((z) => <ZoneBlock key={z.id} zone={z} frame={frame} bottleneck={z.id === bnZone} />)}
      {BUFFERS.map((b) => <BufferSlots key={b.id} buf={b} level={frame?.buffers[b.id] ?? 0} cap={caps[b.id]} />)}

      <ContactShadows position={[5, 0.01, 0]} scale={120} blur={2.5} far={12} opacity={0.55} resolution={1024} />
      <CameraRig />
      <LabelProjector refs={labelRefs} />
      {quality === 'high' && (
        <EffectComposer multisampling={0}>
          <N8AO halfRes aoRadius={2.5} intensity={2.5} />
          <SMAA />
        </EffectComposer>
      )}
    </Canvas>
    <ZoneLabels frame={frame} refs={labelRefs} />
    </div>
  )
}
