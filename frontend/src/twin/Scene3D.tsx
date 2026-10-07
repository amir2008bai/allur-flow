import { CameraControls, ContactShadows, Environment, Lightformer, RoundedBox } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { EffectComposer, N8AO, SMAA } from '@react-three/postprocessing'
import React, { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { SimRun } from '../source'
import { BUFFERS, LINKS, STATE_HEX, STATE_RU, STATUS_HEX, ZONES, ZONE_BY_ID, ZONE_BY_STATION, linkStatus, type Link, type LinkStatus, type StationState, type Zone, type ZoneId } from './layout'
import { useView } from './store'
import { useCause } from './useCause'
import { breathe, damp, easeOutCubic, reducedMotion, smoothstep } from './motion'
import { CauseBadges, CauseFx3D, CauseProjector } from './CauseFx'
import { AssemblyLine, PaintBooth, QcArch, Racks, Sedan, WeldRobot } from './models'

type Frame = SimRun['frames'][number]

const BODY_COLOR = '#f7f8fa'
const PAINTED = '#3b5b8c'

function CarBody(props: { position: [number, number, number]; color?: string; scale?: number; rotY?: number }) {
  return <Sedan {...props} />
}

/** Маяк участка: цвет меняется плавно; авария — спокойное «дыхание», а не стробоскоп. */
function Beacon({ state, y }: { state: StationState; y: number }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null)
  const target = useMemo(() => new THREE.Color(STATE_HEX[state]), [state])
  const still = useMemo(reducedMotion, [])
  useFrame(({ clock }, dt) => {
    if (!mat.current) return
    mat.current.color.lerp(target, Math.min(1, dt * 5)); mat.current.emissive.lerp(target, Math.min(1, dt * 5))
    const goal = state === 'down' ? 0.6 + (still ? 0.6 : breathe(clock.elapsedTime, 1.6) * 1.4) : state === 'blocked' ? 1.0 : state === 'working' ? 0.8 : 0.08
    mat.current.emissiveIntensity = damp(mat.current.emissiveIntensity, goal, 8, dt)
  })
  return (
    <group position={[0, y, 0]}>
      <mesh><cylinderGeometry args={[0.24, 0.24, 0.42, 48]} /><meshStandardMaterial ref={mat} color={STATE_HEX[state]} emissive={STATE_HEX[state]} roughness={0.3} toneMapped={false} /></mesh>
      <mesh position={[0, -0.26, 0]}><cylinderGeometry args={[0.27, 0.27, 0.1, 48]} /><meshStandardMaterial color="#3a3f46" roughness={0.45} metalness={0.3} /></mesh>
    </group>
  )
}

function Equipment({ zone, state }: { zone: Zone; state: StationState | null }) {
  const working = state === 'working'
  switch (zone.id) {
    case 'welding':
      return <>
        <WeldRobot x={-2.4} z={-2.2} working={working} phase={0} />
        <WeldRobot x={2.4} z={2.2} working={working} phase={1.7} flip />
      </>
    case 'paint':
      return <PaintBooth working={working} />
    case 'assembly':
      return <AssemblyLine working={working} />
    case 'qc':
      return <QcArch working={working} />
    default:
      return <Racks />
  }
}

const GLOW: Record<StationState, string> = { working: '#22c55e', blocked: '#f59e0b', down: '#ef4444', starved: '#cbd5e1' }

/** Мягкое свечение вокруг участка: зелёное — идёт работа, жёлтое — затор, красное — стоит. */
function StateGlow({ zone, state }: { zone: Zone; state: StationState }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null)
  const color = useMemo(() => new THREE.Color(GLOW[state]), [state])
  useFrame(({ clock }, dt) => {
    if (!mat.current) return
    mat.current.color.lerp(color, Math.min(1, dt * 4))
    const base = state === 'starved' ? 0.1 : 0.3
    const goal = base + (state === 'down' ? breathe(clock.elapsedTime, 1.6) * 0.18 : breathe(clock.elapsedTime, 4) * 0.05)
    mat.current.opacity = damp(mat.current.opacity, goal, 6, dt)
  })
  return (
    <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[zone.w + 1.2, zone.d + 1.2]} />
      <meshBasicMaterial ref={mat} transparent opacity={0.3} toneMapped={false} depthWrite={false} />
    </mesh>
  )
}

/** Кольцо прогресса над кузовом (как в Apple Watch): тонкая дорожка и дуга, которая заполняется за цикл. */
const progressMat = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, toneMapped: false,
  uniforms: { uProgress: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color('#22c55e') } },
  vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `varying vec2 vP; uniform float uProgress; uniform float uOpacity; uniform vec3 uColor;
    void main(){
      float a = fract(atan(vP.x, vP.y) / 6.2831853 + 1.0);        // 0 — сверху, по часовой
      float on = step(a, uProgress);
      vec3 c = mix(vec3(0.86, 0.89, 0.92), uColor, on);
      float alpha = mix(0.35, 1.0, on) * uOpacity;
      gl_FragColor = vec4(c, alpha);
    }`,
})
const CYCLE_S = 2.6
function ProcessRing({ y }: { y: number }) {
  const mat = useMemo(progressMat, [])
  const born = useRef<number | null>(null)
  const still = useMemo(reducedMotion, [])
  useEffect(() => () => mat.dispose(), [mat])
  useFrame(({ clock }, dt) => {
    if (born.current == null) born.current = clock.elapsedTime
    const p = still ? 0.75 : ((clock.elapsedTime - born.current) % CYCLE_S) / CYCLE_S
    mat.uniforms.uProgress.value = easeOutCubic(Math.min(1, p / 0.9))   // заполнение с замедлением, короткая пауза в конце
    mat.uniforms.uOpacity.value = damp(mat.uniforms.uOpacity.value, 0.95, 5, dt)
  })
  return (
    <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mat} renderOrder={3}>
      <ringGeometry args={[1.12, 1.2, 96]} />
    </mesh>
  )
}

/** Связь между участками: бегущие стрелки на полу и кузов, который едет к следующему участку. */
function FlowLink({ link, status }: { link: Link; status: LinkStatus }) {
  const x0 = link.from.x + link.from.w / 2 + 0.3
  const x1 = link.to.x - link.to.w / 2 - 0.3
  const len = x1 - x0
  const n = Math.max(2, Math.floor(len / 2.2))
  const arrows = useRef<THREE.Group>(null)
  const car = useRef<THREE.Group>(null)
  const phase = useRef(Math.random())
  const color = useMemo(() => new THREE.Color(STATUS_HEX[status]), [status])
  const mats = useRef<THREE.MeshBasicMaterial[]>([])
  const flowOn = useRef(1)
  const carVis = useRef(0)
  const shape = useMemo(() => {
    const sh = new THREE.Shape()
    sh.moveTo(-0.32, -0.55); sh.lineTo(0.32, 0); sh.lineTo(-0.32, 0.55); sh.lineTo(-0.14, 0); sh.closePath()
    return sh
  }, [])
  const z = link.buffer ? -0.0 : 0
  useFrame((_, dt) => {
    const moving = status === 'flow'
    if (moving) phase.current = (phase.current + dt * 0.45) % 1
    flowOn.current = damp(flowOn.current, moving ? 1 : 0.45, 3, dt)
    if (arrows.current) arrows.current.children.forEach((c, i) => {
      const u = (i / n + phase.current) % 1
      c.position.x = x0 + u * len
      const m = mats.current[i]
      if (m) { m.color.lerp(color, Math.min(1, dt * 5)); m.opacity = 0.85 * flowOn.current * smoothstep(0, 0.15, u) * (1 - smoothstep(0.85, 1, u)) }
    })
    if (car.current) {
      const u = phase.current
      const show = moving && !link.buffer ? smoothstep(0, 0.08, u) * (1 - smoothstep(0.92, 1, u)) : 0
      carVis.current = damp(carVis.current, show, 10, dt)
      car.current.visible = carVis.current > 0.02
      car.current.scale.setScalar(0.85 + 0.15 * carVis.current)
      car.current.position.x = x0 + u * len
    }
  })
  const lane = link.buffer ? 4.6 : 0  // у буферов стрелки идут сбоку, чтобы не перекрывать кузова
  return (
    <group position={[0, 0, z]}>
      <group ref={arrows}>
        {Array.from({ length: n }, (_, i) => (
          <mesh key={i} position={[x0, 0.04, lane]} rotation={[-Math.PI / 2, 0, 0]}>
            <shapeGeometry args={[shape]} />
            <meshBasicMaterial ref={(m) => { if (m) mats.current[i] = m }} color={STATUS_HEX[status]} transparent opacity={0} depthWrite={false} toneMapped={false} />
          </mesh>
        ))}
      </group>
      <group ref={car}><CarBody position={[0, 0.05, 0]} scale={0.6} rotY={0} color="#c9ced6" /></group>
    </group>
  )
}

/** Кузов в буфере плавно «вырастает» при появлении. */
function PopCar(props: { position: [number, number, number]; color: string }) {
  const ref = useRef<THREE.Group>(null)
  const k = useRef(0)
  useFrame((_, dt) => {
    if (!ref.current || k.current >= 1) return
    k.current = Math.min(1, k.current + dt / 0.45)
    const e = easeOutCubic(k.current)
    ref.current.scale.setScalar(0.6 + 0.4 * e)
    ref.current.position.y = props.position[1] + (1 - e) * 0.35   // «опускается» на место
  })
  return <group ref={ref} position={props.position} scale={0.6}><CarBody position={[0, 0, 0]} scale={0.55} rotY={0} color={props.color} /></group>
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
  const born = useRef<number | null>(null)
  const still = useMemo(reducedMotion, [])
  useEffect(() => () => geo.dispose(), [geo])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (born.current == null) born.current = t
    // появление: 0,35 с, мягкое замедление (ease-out cubic), чуть «вырастает» к участку
    const k = still ? 1 : Math.min(1, (t - born.current) / 0.35)
    const e = 1 - Math.pow(1 - k, 3)
    if (main.current) {
      main.current.scale.setScalar(1.04 - 0.04 * e)
      ;(main.current.material as THREE.MeshBasicMaterial).opacity = 0.9 * e
    }
    // волна: расходится и тает за 70% периода, потом пауза (рамка лежит в плоскости XY группы → масштаб по x и y)
    if (wave.current) {
      const p = still ? 1 : ((t - born.current) % HALO_PERIOD) / HALO_PERIOD
      const q = Math.min(1, p / 0.7)
      const eq = 1 - Math.pow(1 - q, 2)
      const grow = 0.45 * eq   // волна уходит наружу на 45 см — одинаково по всем сторонам
      wave.current.scale.set(1 + (2 * grow) / (w + 2 * HALO_GAP), 1 + (2 * grow) / (d + 2 * HALO_GAP), 1)
      ;(wave.current.material as THREE.MeshBasicMaterial).opacity = still ? 0 : 0.35 * (1 - q) * e
    }
  })
  return (
    <group position={[0, 0.215, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh ref={main} geometry={geo} renderOrder={2}>
        <meshBasicMaterial color={HALO} transparent opacity={0} toneMapped={false} depthWrite={false} />
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
      {hasBody && <CarBody position={[0, zone.id === 'assembly' ? 0.6 : 0.2, 0]} color={zone.id === 'welding' ? '#c9ced6' : PAINTED} />}
      {state === 'working' && zone.id !== 'paint' && <ProcessRing y={zone.id === 'assembly' ? 1.9 : 1.5} />}
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
    ref.current.rotation.y = clock.elapsedTime * 0.5
    ref.current.position.y = y + Math.sin(clock.elapsedTime * 1.1) * 0.08
  })
  return (
    <mesh ref={ref} position={[0, y, 0]}>
      <octahedronGeometry args={[0.38]} />
      <meshStandardMaterial color="#7c3aed" emissive="#7c3aed" emissiveIntensity={0.9} roughness={0.25} metalness={0.2} flatShading toneMapped={false} />
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
        ? <PopCar key={i} position={p} color={painted ? PAINTED : '#c9ced6'} />
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
    const cx = z ? z.x + 7 : 5.5
    const width = z ? Math.max(z.w, z.d) + 24 : 96
    const depth = z ? z.d + 8 : 30
    const dist = Math.max((width / 2) / Math.tan(hfov / 2), (depth / 2) / Math.tan(vfov / 2)) * 1.1
    const polar = selected ? 0.95 : 0.9
    const azim = selected ? 0.3 : 0.12
    const tx = cx, ty = 0, tz = z ? z.z : 0
    c.setLookAt(tx + dist * Math.sin(polar) * Math.sin(azim), ty + dist * Math.cos(polar), tz + dist * Math.sin(polar) * Math.cos(azim), tx, ty, tz, true)
  }, [selected, size.width, size.height])
  return <CameraControls ref={ref} makeDefault minDistance={6} maxDistance={220} maxPolarAngle={Math.PI / 2.15} smoothTime={0.75} />
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
  const causeRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const incident = useCause(run)
  const steps = incident?.steps ?? []

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
      {LINKS.map((l) => <FlowLink key={l.from.id} link={l} status={linkStatus(l, frame?.states)} />)}

      {ZONES.map((z) => <ZoneBlock key={z.id} zone={z} frame={frame} bottleneck={z.id === bnZone} />)}
      {BUFFERS.map((b) => <BufferSlots key={b.id} buf={b} level={frame?.buffers[b.id] ?? 0} cap={caps[b.id]} />)}

      <ContactShadows position={[5, 0.01, 0]} scale={120} blur={3} far={12} opacity={0.45} resolution={1024} />
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
    </Canvas>
    <ZoneLabels frame={frame} refs={labelRefs} />
    <CauseBadges steps={steps} refs={causeRefs} />
    </div>
  )
}
