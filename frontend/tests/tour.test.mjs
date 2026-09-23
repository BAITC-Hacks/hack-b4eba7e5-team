import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/tour.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})
const { getTourSpotlight } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)

function assertInside(rect, viewport) {
  assert.ok(Object.values(rect).every(Number.isFinite))
  assert.ok(rect.x >= 0 && rect.y >= 0 && rect.width >= 0 && rect.height >= 0)
  assert.ok(rect.x + rect.width <= viewport.width)
  assert.ok(rect.y + rect.height <= viewport.height)
}

test('Подсветка окружает видимый элемент с отступом 6px', () => {
  assert.deepEqual(
    getTourSpotlight({ x: 100, y: 200, width: 400, height: 250 }, { width: 1280, height: 800 }),
    { x: 94, y: 194, width: 412, height: 262 },
  )
})

test('При прокрутке подсветка точно следует элементу без промежуточной геометрии', () => {
  const viewport = { width: 1280, height: 800 }
  const target = { x: 100, y: 400, width: 400, height: 100 }
  const start = getTourSpotlight(target, viewport)
  for (const offset of [1, 25, 120, 250]) {
    const current = getTourSpotlight({ ...target, y: target.y - offset }, viewport)
    assert.equal(current.y, start.y - offset)
    assert.equal(current.x, start.x)
    assert.equal(current.width, start.width)
    assert.equal(current.height, start.height)
  }
  assert.deepEqual(getTourSpotlight(target, viewport), start)
})

test('На телефоне подсветка больших областей сохраняет края 8px', () => {
  assert.deepEqual(
    getTourSpotlight({ x: 0, y: 0, width: 800, height: 1200 }, { width: 360, height: 640 }),
    { x: 8, y: 8, width: 344, height: 624 },
  )
})

test('Частично скрытая область обрезается только по невидимым краям', () => {
  assert.deepEqual(
    getTourSpotlight({ x: -80, y: -60, width: 300, height: 220 }, { width: 360, height: 640 }),
    { x: 8, y: 8, width: 218, height: 158 },
  )
  assert.deepEqual(
    getTourSpotlight({ x: 240, y: 500, width: 300, height: 220 }, { width: 360, height: 640 }),
    { x: 234, y: 494, width: 118, height: 138 },
  )
})

test('Полностью скрытый элемент не превращается в выделенную область у края', () => {
  const viewport = { width: 360, height: 640 }
  for (const point of [-500, 2000]) {
    const spotlight = getTourSpotlight({ x: point, y: point, width: 40, height: 40 }, viewport)
    assertInside(spotlight, viewport)
    assert.equal(spotlight.width, 0)
    assert.equal(spotlight.height, 0)
  }
})

test('Геометрия конечна, воспроизводима и не меняет входные объекты', () => {
  for (const viewport of [{ width: 360, height: 640 }, { width: 4, height: 4 }, { width: 0, height: 0 }]) {
    for (const target of [
      { x: 0, y: 0, width: 0, height: 0 },
      { x: 10, y: 50, width: 4000, height: 4000 },
      { x: NaN, y: Infinity, width: -10, height: NaN },
    ]) {
      const original = { ...target }
      const originalViewport = { ...viewport }
      const spotlight = getTourSpotlight(target, viewport)
      assertInside(spotlight, viewport)
      assert.deepEqual(spotlight, getTourSpotlight(target, viewport))
      assert.deepEqual(target, original)
      assert.deepEqual(viewport, originalViewport)
    }
  }
})
