// Только оболочки оборудования: нет таймеров, приводов и изменений кинематики.
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { StaticBatch } from './StaticBatch'

const aluminium = { color: '#c3cbd5', metalness: 0.55, roughness: 0.38 }
const shell = { color: '#eef1f5', metalness: 0.08, roughness: 0.55 }

export function ArmCable({ length }: { length: number }) {
  const geometry = useMemo(() => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.2, 0.08, -0.24), new THREE.Vector3(-0.35, length * 0.35, -0.24),
    new THREE.Vector3(-0.3, length * 0.75, -0.24), new THREE.Vector3(-0.13, length - 0.05, -0.2),
  ]), 12, 0.037, 6, false), [length])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh geometry={geometry}><meshStandardMaterial color="#444d59" roughness={0.75} /></mesh>
}

export function JointCaps({ radius, width }: { radius: number; width: number }) {
  return <StaticBatch key={`${radius}-${width}`}>{[-1, 1].map((side) => <group key={side} position={[0, 0, side * (width / 2 + 0.012)]}>
    <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[radius * 0.74, radius * 0.74, 0.03, 16]} /><meshStandardMaterial {...aluminium} /></mesh>
    <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[radius * 0.24, radius * 0.24, 0.05, 6]} /><meshStandardMaterial color="#687585" metalness={0.6} roughness={0.4} /></mesh>
  </group>)}</StaticBatch>
}

export function RobotBaseDetails() {
  return <StaticBatch>
    {[-0.38, 0.38].map((x) => [-0.38, 0.38].map((z) => <mesh key={`${x}-${z}`} position={[x, 0.34, z]}>
      <cylinderGeometry args={[0.055, 0.055, 0.08, 6]} /><meshStandardMaterial {...aluminium} />
    </mesh>))}
    <mesh position={[-0.45, 0.49, -0.1]}><boxGeometry args={[0.18, 0.24, 0.34]} /><meshStandardMaterial {...shell} /></mesh>
    <mesh position={[-0.548, 0.5, -0.1]}><boxGeometry args={[0.015, 0.05, 0.19]} /><meshStandardMaterial color="#a44549" /></mesh>
  </StaticBatch>
}

export function WeldingJaws() {
  return <StaticBatch>
    <mesh position={[0.13, 0.28, 0]}><boxGeometry args={[0.09, 0.32, 0.12]} /><meshStandardMaterial {...aluminium} /></mesh>
    <mesh position={[0.08, 0.47, 0]}><boxGeometry args={[0.22, 0.065, 0.12]} /><meshStandardMaterial {...aluminium} /></mesh>
    <mesh position={[0, 0.52, 0]}><cylinderGeometry args={[0.04, 0.04, 0.11, 12]} /><meshStandardMaterial color="#b78d61" metalness={0.6} roughness={0.4} /></mesh>
  </StaticBatch>
}

function Console({ position }: { position: [number, number, number] }) {
  return <group position={position}>
    <mesh position={[0, 0.7, 0]}><boxGeometry args={[0.65, 1.4, 0.4]} /><meshStandardMaterial {...shell} /></mesh>
    <mesh position={[0, 1.08, 0.21]}><boxGeometry args={[0.45, 0.32, 0.025]} /><meshStandardMaterial color="#294762" roughness={0.4} /></mesh>
    <mesh position={[0.18, 0.75, 0.23]}><sphereGeometry args={[0.045, 8, 8]} /><meshStandardMaterial color="#b74b50" /></mesh>
  </group>
}

export function BoothDetails() {
  return <StaticBatch>
    {[-3, 3].map((z) => <group key={z}>
      <mesh position={[0, 0.66, z]}><boxGeometry args={[9, 0.9, 0.09]} /><meshStandardMaterial {...shell} /></mesh>
      {[-2.8, 0, 2.8].map((x) => <mesh key={x} position={[x, 2.6, z]}><boxGeometry args={[0.045, 2.8, 0.065]} /><meshStandardMaterial {...aluminium} /></mesh>)}
    </group>)}
    {[-3.6, 3.6].map((x) => <group key={x} position={[x, 4.55, 0]}>
      <mesh><cylinderGeometry args={[0.49, 0.49, 0.17, 16]} /><meshStandardMaterial {...shell} /></mesh>
      <mesh position={[0, 0.09, 0]}><cylinderGeometry args={[0.37, 0.37, 0.015, 16]} /><meshStandardMaterial color="#6f7b8a" roughness={0.75} /></mesh>
      <mesh position={[0, 0.11, 0]}><boxGeometry args={[0.72, 0.025, 0.04]} /><meshStandardMaterial {...aluminium} /></mesh>
    </group>)}
    {[-1.7, 1.7].map((z) => <group key={z} position={[0, 0.23, z]}>
      <mesh><boxGeometry args={[8, 0.035, 0.65]} /><meshStandardMaterial color="#a4afbb" /></mesh>
      {[-3, -2, -1, 0, 1, 2, 3].map((x) => <mesh key={x} position={[x, 0.025, 0]}><boxGeometry args={[0.07, 0.02, 0.59]} /><meshStandardMaterial color="#667584" /></mesh>)}
    </group>)}
    <Console position={[5.3, 0.2, 2.5]} />
  </StaticBatch>
}

export function AssemblyDetails() {
  return <StaticBatch>
    {[-8, 8].map((x) => <mesh key={x} position={[x, 0.44, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.19, 0.19, 2.2, 16]} /><meshStandardMaterial {...aluminium} />
    </mesh>)}
    {[-6, 6].map((x) => <group key={x} position={[x, 0.2, 3.9]}>
      <mesh position={[0, 0.58, 0]}><boxGeometry args={[1.4, 1, 0.7]} /><meshStandardMaterial color="#ccd4dd" roughness={0.6} /></mesh>
      <mesh position={[0, 1.12, 0]}><boxGeometry args={[1.6, 0.1, 0.85]} /><meshStandardMaterial color="#515d6c" roughness={0.6} /></mesh>
      {[0.32, 0.58, 0.84].map((y) => <mesh key={y} position={[0, y, 0.365]}><boxGeometry args={[1.2, 0.012, 0.025]} /><meshStandardMaterial color="#8b99a9" /></mesh>)}
    </group>)}
  </StaticBatch>
}

export function QcDetails() {
  return <StaticBatch>
    {[-1.25, 1.25].map((x) => <group key={x}>
      {[-1.9, 1.9].map((z) => <mesh key={z} position={[x, 1.8, z]}><boxGeometry args={[0.2, 3.2, 0.24]} /><meshStandardMaterial {...shell} /></mesh>)}
      <mesh position={[x, 3.3, 0]}><boxGeometry args={[0.2, 0.15, 4]} /><meshStandardMaterial {...aluminium} /></mesh>
      {[-1.65, 1.65].map((z) => <mesh key={z} position={[x, 2.55, z]} rotation={[0.3, 0, 0]}><boxGeometry args={[0.25, 0.22, 0.2]} /><meshStandardMaterial color="#435367" /></mesh>)}
    </group>)}
    <Console position={[2.6, 0.2, -3]} />
  </StaticBatch>
}
