import { CameraControls, CameraControlsImpl, ContactShadows, Environment, Lightformer, RoundedBox } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { EffectComposer, N8AO, SMAA } from '@react-three/postprocessing'
import React, { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { SimRun } from '../source'
import { BUFFERS, LINKS, STATE_HEX, STATE_RU, STATUS_HEX, ZONES, ZONE_BY_ID, ZONE_BY_STATION, linkStatus, type Link, type LinkStatus, type StationState, type Zone, type ZoneId } from './layout'
import { useView } from './store'
import { useCause } from './useCause'
import { breathe, damp, reducedMotion, smoothstep } from './motion'
import { SceneMotion, useMotionFrame } from './SceneMotion'
import { useReducedMotion } from './motionPreference'
import { BOTTLENECK_HEX } from '../theme'
import { CauseBadges, CauseFx3D, CauseProjector } from './CauseFx'
import { AssemblyLine, PaintBooth, QcArch, Racks, Sedan, WeldRobot } from './models'

type Frame = SimRun['frames'][number]

const PAINTED = '#3b5b8c'

function CarBody(props: { position: [number, number, number]; color?: string; scale?: number; rotY?: number; unfinished?: boolean; detailed?: boolean }) {
  return <Sedan {...props} />
}

/** Маяк участка: цвет меняется плавно; авария — спокойное «дыхание», а не стробоскоп. */
function Beacon({ state, y }: { state: StationState; y: number }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null)
  const previous = useRef<StationState | null>(null)
  const target = useMemo(() => new THREE.Color(STATE_HEX[state]), [state])
  useMotionFrame(({ time, dt, frozen }) => {
    if (!mat.current) return
    if (frozen && previous.current === state) return
    previous.current = state
    const blend = frozen ? 1 : 1 - Math.exp(-5 * dt)
    mat.current.color.lerp(target, blend); mat.current.emissive.lerp(target, blend)
    const goal = state === 'down' ? 0.65 + breathe(time, 2.8) * 0.65 : state === 'blocked' ? 0.8 : state === 'working' ? 0.65 : 0.08
    mat.current.emissiveIntensity = frozen ? goal : damp(mat.current.emissiveIntensity, goal, 8, dt)
  })
  return (
    <group position={[0, y, 0]}>
      <mesh><cylinderGeometry args={[0.24, 0.24, 0.42, 48]} /><meshStandardMaterial ref={mat} color={STATE_HEX[state]} emissive={STATE_HEX[state]} roughness={0.3} toneMapped={false} /></mesh>
      <mesh position={[0, -0.26, 0]}><cylinderGeometry args={[0.27, 0.27, 0.1, 48]} /><meshStandardMaterial color="#3a3f46" roughness={0.45} metalness={0.3} /></mesh>
    </group>
  )
}

const Equipment = React.memo(function Equipment({ zone, state }: { zone: Zone; state: StationState | null }) {
  const working = state === 'working'
  switch (zone.id) {
    case 'welding':
      return <>
        <WeldRobot x={-2.2} z={-1.8} working={working} phase={0} />
        <WeldRobot x={2.2} z={1.8} working={working} phase={1.7} flip />
      </>
    case 'paint':
      return <PaintBooth working={working} />
    case 'assembly':
      return <AssemblyLine working={working} hasBody={!!state && state !== 'starved'} />
    case 'qc':
      return <QcArch working={working} />
    case 'warehouse_out':
      return null
    default:
      return <Racks />
  }
})

/** Мягкое свечение вокруг участка: зелёное — идёт работа, жёлтое — затор, красное — стоит. */
function StateGlow({ zone, state }: { zone: Zone; state: StationState }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null)
  const previous = useRef<StationState | null>(null)
  const color = useMemo(() => new THREE.Color(STATE_HEX[state]), [state])
  useMotionFrame(({ time, dt, frozen }) => {
    if (!mat.current) return
    if (frozen && previous.current === state) return
    previous.current = state
    mat.current.color.lerp(color, frozen ? 1 : 1 - Math.exp(-4 * dt))
    const base = state === 'starved' ? 0.08 : 0.18
    const goal = base + (state === 'down' ? breathe(time, 2.8) * 0.07 : 0)
    mat.current.opacity = frozen ? goal : damp(mat.current.opacity, goal, 6, dt)
  })
  return (
    <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[zone.w + 1.2, zone.d + 1.2]} />
      <meshBasicMaterial ref={mat} transparent opacity={0.3} toneMapped={false} depthWrite={false} />
    </mesh>
  )
}

/** Условный перенос кузова использует существующую фазу стрелок, не отдельные часы/VIN. */
function FlowLink({ link, status }: { link: Link; status: LinkStatus }) {
  const x0 = link.from.x + link.from.w / 2 + 0.3
  const x1 = link.to.x - link.to.w / 2 - 0.3
  const len = x1 - x0
  const n = Math.max(2, Math.floor(len / 2.2))
  const arrows = useRef<THREE.Group>(null)
  const phase = useRef(0.15)
  const color = useMemo(() => new THREE.Color(STATUS_HEX[status]), [status])
  const mats = useRef<THREE.MeshBasicMaterial[]>([])
  const flowOn = useRef(1)
  const previous = useRef<LinkStatus | null>(null)
  const car = useRef<THREE.Group>(null)
  const carMaterials = useRef<THREE.Material[]>([])
  const shape = useMemo(() => {
    const sh = new THREE.Shape()
    sh.moveTo(-0.32, -0.55); sh.lineTo(0.32, 0); sh.lineTo(-0.32, 0.55); sh.lineTo(-0.14, 0); sh.closePath()
    return sh
  }, [])
  const z = link.buffer ? -0.0 : 0
  useMotionFrame(({ dt, frozen }) => {
    if (frozen && previous.current === status) return
    previous.current = status
    const moving = status === 'flow'
    if (moving) phase.current = (phase.current + dt * 0.16) % 1
    flowOn.current = frozen ? (moving ? 1 : 0.45) : damp(flowOn.current, moving ? 1 : 0.45, 3, dt)
    if (arrows.current) arrows.current.children.forEach((c, i) => {
      const u = (i / n + phase.current) % 1
      c.position.x = x0 + u * len
      const m = mats.current[i]
      if (m) { m.color.lerp(color, frozen ? 1 : 1 - Math.exp(-5 * dt)); m.opacity = 0.7 * flowOn.current * smoothstep(0, 0.15, u) * (1 - smoothstep(0.85, 1, u)) }
    })
    if (car.current) {
      const u = phase.current
      car.current.position.x = x0 + u * len
      // При заторе/остановке кузов остаётся на месте; пустая связь не создаёт поток.
      const opacity = (status === 'idle' ? 0 : 1) * smoothstep(0, 0.12, u) * (1 - smoothstep(0.88, 1, u))
      car.current.visible = opacity > 0.01
      if (!carMaterials.current.length) car.current.traverse((o) => {
        if (o instanceof THREE.Mesh) carMaterials.current.push(...(Array.isArray(o.material) ? o.material : [o.material]))
      })
      carMaterials.current.forEach((m) => {
        const transparent = opacity < 1
        if (m.transparent !== transparent) { m.transparent = transparent; m.needsUpdate = true }
        m.opacity = opacity
      })
    }
  })
  const lane = link.buffer ? 4.6 : 0  // у буферов стрелки идут сбоку, чтобы не перекрывать кузова
  return (
    <group position={[0, 0, z]}>
      <group ref={car} name={`transfer-${link.from.id}-${link.to.id}`} position={[x0, 0.06, lane]}>
        <CarBody position={[0, 0, 0]} rotY={0} scale={1.45}
          color={link.from.id === 'welding' || link.from.id === 'warehouse_in' ? '#a8b3c0' : PAINTED}
          unfinished={link.from.id === 'warehouse_in' || link.from.id === 'welding' || link.from.id === 'paint'} />
      </group>
      <group ref={arrows}>
        {Array.from({ length: n }, (_, i) => (
          <mesh key={i} position={[x0, 0.04, lane]} rotation={[-Math.PI / 2, 0, 0]}>
            <shapeGeometry args={[shape]} />
            <meshBasicMaterial ref={(m) => { if (m) mats.current[i] = m }} color={STATUS_HEX[status]} transparent opacity={0} depthWrite={false} toneMapped={false} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

/** Постоянные слоты: короткий въезд/выезд без изменения размеров кузова. */
function PopCar(props: { position: [number, number, number]; color: string; occupied: boolean; unfinished: boolean; scale?: number; rotY?: number; detailed?: boolean }) {
  const { ref, opacity } = useOccupancy(props.occupied)
  useMotionFrame(() => {
    if (ref.current) ref.current.position.x = props.position[0] - (1 - opacity.current) * 0.25
  })
  return <group ref={ref} position={props.position}><CarBody position={[0, 0, 0]} scale={props.scale ?? 0.55} rotY={props.rotY ?? Math.PI / 2} color={props.color} unfinished={props.unfinished} detailed={props.detailed ?? false} /></group>
}

/** Четыре условных места иллюстрируют готовые машины, не заменяют счётчик выпуска. */
function FinishedYard({ good }: { good: number }) {
  return <group>
    {[-1.9, 1.9].flatMap((x, col) => [-2.6, 2.6].map((z, row) => <group key={`${x}-${z}`}>
      <mesh position={[x, 0.22, z]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[3.3, 4.2]} /><meshStandardMaterial color="#e6ebf0" roughness={0.9} /></mesh>
      {[-1.5, 1.5].map((dx) => <mesh key={dx} position={[x + dx, 0.23, z]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.07, 4]} /><meshBasicMaterial color="#ffffff" /></mesh>)}
      <PopCar position={[x, 0.25, z]} scale={1.75} color={col === 0 ? PAINTED : '#edf0f4'} unfinished={false} detailed occupied={good > col * 2 + row} />
    </group>))}
  </group>
}

/** Изменение наличия кузова сглажено отдельно от часов смены, чтобы ×7200 не давало мигания. */
function useOccupancy(occupied: boolean) {
  const ref = useRef<THREE.Group>(null)
  const opacity = useRef(occupied ? 1 : 0)
  const previous = useRef<boolean | null>(null)
  const materials = useRef<THREE.Material[]>([])
  useMotionFrame(({ dt, frozen }) => {
    if (!ref.current) return
    if (frozen && previous.current === occupied) return
    const target = occupied ? 1 : 0
    const next = frozen ? target : damp(opacity.current, target, occupied ? 8 : 12, dt)
    if (next === opacity.current && previous.current === occupied) return
    previous.current = occupied
    opacity.current = Math.abs(next - target) < 0.001 ? target : next
    ref.current.visible = opacity.current > 0.01
    if (!materials.current.length) ref.current.traverse((o) => {
      if (o instanceof THREE.Mesh) materials.current.push(...(Array.isArray(o.material) ? o.material : [o.material]))
    })
    materials.current.forEach((m) => {
      const transparent = opacity.current < 1
      if (m.transparent !== transparent) { m.transparent = transparent; m.needsUpdate = true }
      m.opacity = opacity.current
    })
  })
  return { ref, opacity }
}

function StationCar({ zone, occupied }: { zone: Zone; occupied: boolean }) {
  const { ref } = useOccupancy(occupied)
  return <group ref={ref}>
    <CarBody position={[0, 0.22, 0]} rotY={0} scale={2.2} color={zone.id === 'welding' ? '#c9ced6' : PAINTED} unfinished={zone.id === 'welding' || zone.id === 'paint'} />
  </group>
}

// ── Выделение участка: тонкая светло-голубая рамка по форме участка (как фокус у Apple) ──────────
const HALO = '#38bdf8'          // sky-400: заметен на белом полу, не спорит со статусами (зелёный/жёлтый/красный)
const HALO_GAP = 0.45           // отступ рамки от края участка, м
const HALO_W = 0.09             // толщина линии, м
const HALO_PERIOD = 2.4         // волна раз в 2,4 с — спокойно, не дёргает внимание

/** Контур скруглённого прямоугольника шириной HALO_W (плоский, лежит на полу). */
function roundedOutline(w: number, d: number, r: number, width: number) {
  const rect = (hw: number, hd: number, rr: number) => {
    const p = new THREE.Path()
    p.moveTo(-hw + rr, -hd); p.lineTo(hw - rr, -hd); p.quadraticCurveTo(hw, -hd, hw, -hd + rr)
    p.lineTo(hw, hd - rr); p.quadraticCurveTo(hw, hd, hw - rr, hd); p.lineTo(-hw + rr, hd)
    p.quadraticCurveTo(-hw, hd, -hw, hd - rr); p.lineTo(-hw, -hd + rr); p.quadraticCurveTo(-hw, -hd, -hw + rr, -hd)
    return p
  }
  const shape = new THREE.Shape(rect(w / 2 + width, d / 2 + width, r + width).getPoints(12))
  shape.holes.push(rect(w / 2, d / 2, r))
  return new THREE.ShapeGeometry(shape, 12)
}

function SelectionHalo({ w, d }: { w: number; d: number }) {
  const geo = useMemo(() => roundedOutline(w + 2 * HALO_GAP, d + 2 * HALO_GAP, 0.55, HALO_W), [w, d])
  const main = useRef<THREE.Mesh>(null)
  const wave = useRef<THREE.Mesh>(null)
  useEffect(() => () => geo.dispose(), [geo])
  useMotionFrame(({ time, reduced }) => {
    if (main.current) {
      ;(main.current.material as THREE.MeshBasicMaterial).opacity = 0.9
    }
    // волна: расходится и тает за 70% периода, потом пауза (рамка лежит в плоскости XY группы → масштаб по x и y)
    if (wave.current) {
      const p = (time % HALO_PERIOD) / HALO_PERIOD
      const q = Math.min(1, p / 0.7)
      const eq = 1 - Math.pow(1 - q, 2)
      const grow = 0.45 * eq   // волна уходит наружу на 45 см — одинаково по всем сторонам
      wave.current.scale.set(1 + (2 * grow) / (w + 2 * HALO_GAP), 1 + (2 * grow) / (d + 2 * HALO_GAP), 1)
      ;(wave.current.material as THREE.MeshBasicMaterial).opacity = reduced ? 0 : 0.16 * (1 - q)
    }
  })
  return (
    <group position={[0, 0.215, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh ref={main} geometry={geo} renderOrder={2}>
        <meshBasicMaterial color={HALO} transparent opacity={0.9} toneMapped={false} depthWrite={false} />
      </mesh>
      <mesh ref={wave} geometry={geo} renderOrder={1}>
        <meshBasicMaterial color={HALO} transparent opacity={0} toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  )
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
      {selected && <SelectionHalo w={zone.w} d={zone.d} />}
      {state && <StateGlow zone={zone} state={state} />}
      <Equipment zone={zone} state={state} />
      {zone.id === 'warehouse_out' && <FinishedYard good={frame?.good ?? 0} />}
      {zone.station && zone.id !== 'assembly' && <StationCar zone={zone} occupied={!!hasBody} />}
      {state === 'working' && <mesh position={[0, 0.225, zone.d / 2 - 0.55]}>
        <boxGeometry args={[zone.w * 0.32, 0.025, 0.065]} />
        <meshBasicMaterial color={STATE_HEX.working} toneMapped={false} />
      </mesh>}
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
  useMotionFrame(({ time }) => {
    if (!ref.current) return
    ref.current.rotation.y = time * 0.15
    ref.current.position.y = y + Math.sin(time * 0.8) * 0.035
  })
  return (
    <mesh ref={ref} position={[0, y, 0]}>
      <octahedronGeometry args={[0.38]} />
      <meshStandardMaterial color={BOTTLENECK_HEX} emissive={BOTTLENECK_HEX} emissiveIntensity={0.6} roughness={0.4} metalness={0.15} flatShading toneMapped={false} />
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
      {slots.map((p, i) => <group key={i}>
        <mesh position={[p[0], 0.04, p[2]]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.5, 1.0]} /><meshBasicMaterial color="#d3d8df" /></mesh>
        <PopCar position={p} occupied={i < level} color={painted ? PAINTED : '#c9ced6'} unfinished={buf.from !== 'assembly'} />
      </group>)}
    </group>
  )
}

/** Сохраняет текущую позицию и незавершённый перелёт при паузе. */
class SceneCameraControls extends CameraControlsImpl {
  update(dt: number) {
    if (!useView.getState().playing || reducedMotion()) return false
    return super.update(Math.min(dt, 0.05))
  }
  applyStaticView() { return super.update(0) }
}

function CameraRig() {
  const ref = useRef<CameraControls>(null)
  const selected = useView((s) => s.selected)
  const playing = useView((s) => s.playing)
  const reduce = useReducedMotion()
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
    const cx = z ? z.x + (size.width < 640 ? 0 : 6) : 5.5
    const width = z ? Math.max(z.w, z.d) + (size.width < 640 ? 8 : 20) : 96
    const depth = z ? z.d + 8 : 30
    const dist = Math.max((width / 2) / Math.tan(hfov / 2), (depth / 2) / Math.tan(vfov / 2)) * 1.1
    const polar = selected ? 0.95 : 0.9
    const azim = selected ? 0.3 : 0.12
    const tx = cx, ty = 0, tz = z ? z.z : 0
    const animate = useView.getState().playing && !reducedMotion()
    c.setLookAt(tx + dist * Math.sin(polar) * Math.sin(azim), ty + dist * Math.cos(polar), tz + dist * Math.sin(polar) * Math.cos(azim), tx, ty, tz, animate)
    if (!animate) (c as SceneCameraControls).applyStaticView()
  }, [selected, size.width, size.height])
  return <CameraControls impl={SceneCameraControls} ref={ref} enabled={playing && !reduce} makeDefault minDistance={6} maxDistance={220} maxPolarAngle={Math.PI / 2.15} smoothTime={0.85} />
}

const LABEL_Y: Partial<Record<ZoneId, number>> = { paint: 4.9 }

function LabelProjector({ refs }: { refs: React.MutableRefObject<Record<string, HTMLDivElement | null>> }) {
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera, size }) => {
    camera.updateMatrixWorld()
    for (const [i, z] of ZONES.entries()) {
      const el = refs.current[z.id]
      if (!el) continue
      v.set(z.x, LABEL_Y[z.id] ?? 3.9, z.z + z.d / 2).project(camera)
      const x = ((v.x + 1) / 2) * size.width
      const y = ((1 - v.y) / 2) * size.height + (size.width < 640 ? (i % 2 === 0 ? -32 : 32) : 0)
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
              {state && <span className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: STATE_HEX[state] }} aria-label={STATE_RU[state]} />}
              {state && (state === 'down' || state === 'blocked') && <span className={state === 'down' ? 'text-red-500' : 'text-amber-600'}>· {STATE_RU[state]}</span>}
            </button>
          </div>
        )
      })}
    </>
  )
}

// Окружение не пересоздаётся на каждом кадре таймлайна: шесть отражающих проходов только при загрузке.
const StudioLighting = React.memo(function StudioLighting({ quality }: { quality: 'high' | 'low' }) {
  return <>
    <ambientLight intensity={0.65} />
    <directionalLight position={[25, 45, 30]} intensity={2.0} castShadow shadow-mapSize={quality === 'high' ? [2048, 2048] : [1024, 1024]}
      shadow-camera-left={-60} shadow-camera-right={60} shadow-camera-top={30} shadow-camera-bottom={-30} />
    <Environment resolution={quality === 'high' ? 256 : 128}>
      <Lightformer intensity={0.8} position={[0, 30, 0]} rotation-x={Math.PI / 2} scale={[80, 20, 1]} />
      <Lightformer intensity={0.5} position={[-40, 10, 20]} rotation-y={Math.PI / 2} scale={[40, 10, 1]} />
      <Lightformer intensity={0.5} position={[40, 10, -20]} rotation-y={-Math.PI / 2} scale={[40, 10, 1]} />
    </Environment>
  </>
})

export default function Scene3D({ run, quality = 'high' }: { run: SimRun; quality?: 'high' | 'low' }) {
  const t = useView((s) => Math.floor(s.t))
  const playing = useView((s) => s.playing)
  const reduce = useReducedMotion()
  const select = useView((s) => s.select)
  const frame = run.frames[Math.min(Math.floor(t), run.frames.length - 1)]
  const bnStation = run.bottleneck.timeline[Math.min(Math.floor(t / 10), run.bottleneck.timeline.length - 1)]?.station
  const bnZone: ZoneId | undefined = bnStation ? ZONE_BY_STATION[bnStation]?.id : undefined
  const caps = run.buffer_cap
  const labelRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const causeRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const incident = useCause(run)
  const steps = incident?.steps ?? []

  return (
    <div className="relative h-full w-full overflow-hidden">
    <Canvas frameloop={playing && !reduce ? 'always' : 'demand'} shadows dpr={[1, quality === 'high' ? 2 : 1]} camera={{ position: [2, 42, 46], fov: 35 }} onPointerMissed={() => select(null)}>
      <SceneMotion>
      <color attach="background" args={['#f5f6f8']} />
      <fog attach="fog" args={['#f5f6f8', 500, 900]} />
      <StudioLighting quality={quality} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[5, 0, 0]}>
        <planeGeometry args={[600, 400]} />
        <meshStandardMaterial color="#f5f6f8" roughness={1} toneMapped={false} />
      </mesh>
      {LINKS.map((l) => <FlowLink key={l.from.id} link={l} status={linkStatus(l, frame?.states)} />)}

      {ZONES.map((z) => <ZoneBlock key={z.id} zone={z} frame={frame} bottleneck={z.id === bnZone} />)}
      {BUFFERS.map((b) => <BufferSlots key={b.id} buf={b} level={frame?.buffers[b.id] ?? 0} cap={caps[b.id]} />)}

      {quality === 'high' && <ContactShadows position={[5, 0.01, 0]} scale={120} blur={3} far={12} opacity={0.3} resolution={512} />}
      <CameraRig />
      <LabelProjector refs={labelRefs} />
      <CauseFx3D steps={steps} />
      <CauseProjector steps={steps} refs={causeRefs} />
      {quality === 'high' && (
        <EffectComposer multisampling={0}>
          <N8AO halfRes aoRadius={2.2} intensity={1.8} />
          <SMAA />
        </EffectComposer>
      )}
      </SceneMotion>
    </Canvas>
    <ZoneLabels frame={frame} refs={labelRefs} />
    <CauseBadges steps={steps} refs={causeRefs} />
    </div>
  )
}
