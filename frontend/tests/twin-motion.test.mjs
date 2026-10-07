import test from 'node:test'
import assert from 'node:assert/strict'
import { Drive, animationRate } from '../src/twin/motion.ts'
import { WELD_SEAMS, weldPose, UPPER_ARM, FOREARM, TOOL, SHOULDER_Y } from '../src/twin/kinematics.ts'

test('ускорение смены не ускоряет движение выше 1,35×', () => {
  for (const speed of [5, 20, 60, 120, 7200, 1000000]) {
    assert.ok(animationRate(speed) >= 0.65 && animationRate(speed) <= 1.35)
  }
  assert.equal(animationRate(20), 1)
  assert.equal(animationRate(60), animationRate(120))
})

test('нулевой шаг полностью сохраняет фазу и скорость привода', () => {
  const drive = new Drive(1.7)
  for (let i = 0; i < 30; i++) drive.step(1 / 60, true)
  const phase = drive.t, speed = drive.speed
  for (let i = 0; i < 300; i++) drive.step(0, i % 2 === 0)
  assert.equal(drive.t, phase)
  assert.equal(drive.speed, speed)
  drive.step(1 / 60, false, 7)
  assert.ok(drive.speed < speed && drive.t > phase)
})

test('инструмент обоих роботов касается всех точек шва и безопасных переездов', () => {
  for (const flip of [false, true]) {
    const x = flip ? 2.2 : -2.2, z = flip ? 1.8 : -1.8
    const seams = WELD_SEAMS.map(([a, b, c]) => [flip ? -a : a, b, flip ? -c : c])
    for (let i = 0; i < seams.length; i++) {
      const a = seams[i], b = seams[(i + 1) % seams.length]
      for (let j = 0; j <= 20; j++) {
        const k = j / 20
        const point = a.map((v, axis) => v + (b[axis] - v) * k)
        point[1] += Math.sin(Math.PI * k) * 0.18
        const [yaw, s, e, w] = weldPose(x, z, point)
        const horizontal = -UPPER_ARM * Math.sin(s) - FOREARM * Math.sin(s + e) - TOOL * Math.sin(s + e + w)
        const tip = [x + horizontal * Math.cos(yaw), SHOULDER_Y + UPPER_ARM * Math.cos(s) + FOREARM * Math.cos(s + e) + TOOL * Math.cos(s + e + w), z - horizontal * Math.sin(yaw)]
        assert.ok(Math.hypot(...tip.map((v, axis) => v - point[axis])) < 1e-9)
      }
    }
  }
})
