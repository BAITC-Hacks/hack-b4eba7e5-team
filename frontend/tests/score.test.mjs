import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

// Используем компилятор проекта, чтобы тесты работали и на Node 20 без встроенной поддержки TS.
const source = await readFile(new URL('../src/lib/score.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})
const { clampScore, scoreAnimationFrame, scoreColor, scoreFrame, scoreSparks } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)

test('Границы шкалы: от 0 до 100, без NaN и бесконечностей', () => {
  for (const [input, expected] of [[-5, 0], [0, 0], [56.54307, 56.54307], [100, 100], [120, 100], [NaN, 0], [Infinity, 0]]) {
    assert.equal(clampScore(input), expected)
  }
})

test('Цвета на 0, 50 и 100: красный, жёлтый, зелёный', () => {
  assert.equal(scoreColor(0), 'rgb(239, 68, 68)')
  assert.equal(scoreColor(50), 'rgb(250, 204, 21)')
  assert.equal(scoreColor(100), 'rgb(34, 197, 94)')
})

test('Промежуточные цвета плавно смешиваются между опорными точками', () => {
  assert.equal(scoreColor(25), 'rgb(245, 136, 45)')
  assert.equal(scoreColor(75), 'rgb(142, 201, 58)')
  assert.equal(scoreColor(-1), scoreColor(0))
  assert.equal(scoreColor(101), scoreColor(100))
})

test('Счётчик растёт от нуля до точного результата без превышения', () => {
  for (const target of [0, 50, 56.54307, 100]) {
    assert.equal(scoreFrame(target, 0), 0)
    assert.equal(scoreFrame(target, 1), target)
    let previous = 0
    for (let step = 0; step <= 100; step += 1) {
      const current = scoreFrame(target, step / 100)
      assert.ok(current >= previous && current <= target)
      previous = current
    }
  }
  assert.equal(scoreFrame(50, -1), 0)
  assert.equal(scoreFrame(50, 2), 50)
})

test('Искры появляются только в момент остановки и исчезают через 900 мс', () => {
  const score = 56.54307
  for (const elapsed of [0, 800, 1599]) {
    const frame = scoreAnimationFrame(score, elapsed)
    assert.ok(frame.value < score)
    assert.equal(frame.sparkProgress, null)
    assert.equal(frame.finished, false)
  }
  assert.deepEqual(scoreAnimationFrame(score, 1600), { value: score, sparkProgress: 0, finished: false })
  assert.deepEqual(scoreAnimationFrame(score, 2050), { value: score, sparkProgress: 0.5, finished: false })
  for (const elapsed of [2500, 10000]) {
    assert.deepEqual(scoreAnimationFrame(score, elapsed), { value: score, sparkProgress: null, finished: true })
  }
})

test('Вспышка охватывает все 360 градусов без дублирования стыка', () => {
  const sparks = scoreSparks(0)
  assert.equal(sparks.origins.length, 40)
  assert.equal(sparks.rays.length, 160)
  assert.equal(new Set(sparks.origins.map(({ x, y }) => `${x},${y}`)).size, 40)
  assert.equal(sparks.origins[0].angle, 0)
  assert.ok(sparks.origins.at(-1).angle < 2 * Math.PI)
  for (const [index, origin] of sparks.origins.entries()) {
    assert.ok(Math.abs(Math.hypot(origin.x - 100, origin.y - 100) - 88) < 1e-8)
    assert.ok(Math.abs(origin.angle - 2 * Math.PI * index / 40) < 1e-8)
    for (const ray of sparks.rays.slice(index * 4, index * 4 + 4)) {
      assert.equal(ray.x1, origin.x)
      assert.equal(ray.y1, origin.y)
    }
  }
})

test('Искры летят и внутрь, и наружу, сохраняя свободный центр для числа', () => {
  for (const progress of [0.1, 0.5, 1]) {
    const sparks = scoreSparks(progress)
    for (const [index, ray] of sparks.rays.entries()) {
      const radius = Math.hypot(ray.x2 - 100, ray.y2 - 100)
      if (index % 4 >= 2) assert.ok(radius < 88 && radius > 40)
      else assert.ok(radius > 88)
    }
  }
})

test('Искры расходятся от кольца и затухают без изменения оценки', () => {
  const start = scoreSparks(0)
  const middle = scoreSparks(0.5)
  const end = scoreSparks(1)
  assert.equal(start.opacity, 1)
  assert.ok(middle.opacity < start.opacity && middle.opacity > end.opacity)
  assert.equal(end.opacity, 0)
  assert.ok(start.glowWidth < middle.glowWidth && middle.glowWidth < end.glowWidth)
  assert.ok(start.innerRadius > middle.innerRadius && middle.innerRadius > end.innerRadius)
  for (let index = 0; index < start.rays.length; index += 1) {
    const ray = middle.rays[index]
    const origin = start.origins[Math.floor(index / 4)]
    assert.ok(Math.hypot(ray.x1 - origin.x, ray.y1 - origin.y) > 0)
    assert.ok(Object.values(ray).every(Number.isFinite))
  }
  assert.equal(scoreAnimationFrame(56.54307, 1900).value, 56.54307)
})
