import { useLayoutEffect, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/** Объединяет только неподвижные детали внутри одного движущегося узла.
 * Материалы разных экземпляров остаются независимыми для прежнего затухания. */
export function StaticBatch({ children }: { children: ReactNode }) {
  const source = useRef<THREE.Group>(null)
  const output = useRef<THREE.Group>(null)
  useLayoutEffect(() => {
    const original = source.current, target = output.current
    if (!original || !target) return
    original.updateWorldMatrix(true, true)
    const inverse = original.matrixWorld.clone().invert()
    const groups = new Map<string, { material: THREE.Material; cast: boolean; receive: boolean; geometries: THREE.BufferGeometry[] }>()
    original.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return
      // Здесь нет текстур: сравниваем параметры, исключая уникальный UUID.
      const { uuid: _uuid, metadata: _metadata, ...settings } = object.material.toJSON()
      const key = JSON.stringify([settings, object.castShadow, object.receiveShadow])
      let group = groups.get(key)
      if (!group) {
        group = { material: object.material, cast: object.castShadow, receive: object.receiveShadow, geometries: [] }
        groups.set(key, group)
      }
      const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone()
      geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld))
      group.geometries.push(geometry)
    })
    const meshes: THREE.Mesh[] = []
    for (const group of groups.values()) {
      const geometry = mergeGeometries(group.geometries, false)
      group.geometries.forEach((part) => part.dispose())
      if (!geometry) throw new Error('StaticBatch: incompatible geometry attributes')
      const mesh = new THREE.Mesh(geometry, group.material)
      mesh.castShadow = group.cast; mesh.receiveShadow = group.receive
      mesh.matrixAutoUpdate = false
      target.add(mesh); meshes.push(mesh)
    }
    return () => { meshes.forEach((mesh) => { target.remove(mesh); mesh.geometry.dispose() }) }
  }, [])
  return <group><group ref={source} visible={false}>{children}</group><group ref={output} /></group>
}
