import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/tour.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})
const { getTourLayout } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)

const cardSize = { height: 180 }
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y

function assertInside(rect, viewport) {
  assert.ok(Object.values(rect).every(Number.isFinite))
  assert.ok(rect.x >= 0 && rect.y >= 0 && rect.width >= 0 && rect.height >= 0)
  assert.ok(rect.x + rect.width <= viewport.width)
  assert.ok(rect.y + rect.height <= viewport.height)
}

test('На широком экране карточка встаёт справа, а у правого края — слева', () => {
  const viewport = { width: 1280, height: 800 }
  for (const x of [100, 900]) {
    const layout = getTourLayout({ x, y: 200, width: 200, height: 300 }, viewport, cardSize)
    assertInside(layout.card, viewport)
    assert.equal(overlaps(layout.spotlight, layout.card), false)
    if (x === 100) assert.ok(layout.card.x >= layout.spotlight.x + layout.spotlight.width)
    else assert.ok(layout.card.x + layout.card.width <= layout.spotlight.x)
  }
})

test('На телефоне 360px карточка помещается под выделением без перекрытия', () => {
  const viewport = { width: 360, height: 780 }
  const layout = getTourLayout({ x: 16, y: 80, width: 328, height: 300 }, viewport, cardSize)
  assertInside(layout.spotlight, viewport)
  assertInside(layout.card, viewport)
  assert.equal(overlaps(layout.spotlight, layout.card), false)
  assert.ok(layout.card.y > layout.spotlight.y)
  assert.ok(layout.card.x >= 12 && layout.card.x + layout.card.width <= 348)
})

test('Для широкой области у низа экрана карточка располагается сверху', () => {
  const viewport = { width: 1000, height: 720 }
  const layout = getTourLayout({ x: 20, y: 400, width: 960, height: 280 }, viewport, cardSize)
  assert.equal(overlaps(layout.spotlight, layout.card), false)
  assert.ok(layout.card.y + layout.card.height <= layout.spotlight.y)
})

test('Частично и полностью скрытые области не выводят подсветку за экран', () => {
  const viewport = { width: 360, height: 640 }
  for (const target of [
    { x: -80, y: -60, width: 300, height: 220 },
    { x: 240, y: 500, width: 300, height: 220 },
    { x: -500, y: -500, width: 40, height: 40 },
    { x: 2000, y: 2000, width: 40, height: 40 },
  ]) {
    const layout = getTourLayout(target, viewport, cardSize)
    assertInside(layout.spotlight, viewport)
    assertInside(layout.card, viewport)
  }
})

test('В низком окне карточка ограничена доступной высотой и сохраняет отступы', () => {
  const viewport = { width: 640, height: 160 }
  const layout = getTourLayout({ x: 20, y: 10, width: 600, height: 140 }, viewport, cardSize)
  assertInside(layout.spotlight, viewport)
  assertInside(layout.card, viewport)
  assert.ok(layout.card.y >= 12 && layout.card.y + layout.card.height <= 148)
  assert.ok(layout.card.height < cardSize.height)
})

test('Геометрия конечна, воспроизводима и не меняет переданные объекты', () => {
  for (const viewport of [{ width: 360, height: 640 }, { width: 4, height: 4 }, { width: 0, height: 0 }]) {
    for (const target of [
      { x: 0, y: 0, width: 0, height: 0 },
      { x: 10, y: 50, width: 4000, height: 4000 },
      { x: NaN, y: Infinity, width: -10, height: NaN },
    ]) {
      const original = { ...target }
      const layout = getTourLayout(target, viewport, cardSize)
      assertInside(layout.card, viewport)
      assertInside(layout.spotlight, viewport)
      assert.deepEqual(layout, getTourLayout(target, viewport, cardSize))
      assert.deepEqual(target, original)
    }
  }
})
