import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import maplibre from 'maplibre-gl'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/mapViewport.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})
const { observeMapSize, mapViewportOptions } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)

function resizeFixture(t) {
  const original = globalThis.ResizeObserver
  let notify
  let disconnected = false
  const element = { clientWidth: 800, clientHeight: 600 }
  globalThis.ResizeObserver = class {
    constructor(callback) { notify = callback }
    observe(target) { assert.equal(target, element) }
    disconnect() { disconnected = true }
  }
  t.after(() => {
    if (original === undefined) delete globalThis.ResizeObserver
    else globalThis.ResizeObserver = original
  })
  const calls = []
  // Других методов карты нет: resize не может менять камеру, слои или создавать карту заново.
  const cleanup = observeMapSize({ resize: () => calls.push('resize'), redraw: () => calls.push('redraw') }, element)
  return { element, calls, notify: () => notify(), cleanup, disconnected: () => disconnected }
}

test('Размер и кадр карты обновляются синхронно, только при изменении размеров', (t) => {
  const fixture = resizeFixture(t)
  fixture.notify()
  assert.deepEqual(fixture.calls, [])
  fixture.element.clientWidth = 640
  fixture.notify()
  assert.deepEqual(fixture.calls, ['resize', 'redraw'])
  fixture.notify()
  assert.equal(fixture.calls.length, 2)
  fixture.element.clientHeight = 560
  fixture.notify()
  assert.deepEqual(fixture.calls, ['resize', 'redraw', 'resize', 'redraw'])
})

test('Серия перетягиваний не добавляет отложенных кадров или смены камеры', (t) => {
  const fixture = resizeFixture(t)
  for (const width of [796, 740, 416, 900, 800]) {
    fixture.element.clientWidth = width
    fixture.notify()
  }
  assert.deepEqual(fixture.calls, Array.from({ length: 5 }, () => ['resize', 'redraw']).flat())
  assert.equal(mapViewportOptions.trackResize, false)
})

test('Скрытая и удалённая карта не вызывает обновления canvas', (t) => {
  const fixture = resizeFixture(t)
  fixture.element.clientWidth = 0
  fixture.notify()
  fixture.element.clientWidth = 400
  fixture.element.clientHeight = 0
  fixture.notify()
  assert.deepEqual(fixture.calls, [])
  fixture.element.clientHeight = 600
  fixture.notify()
  assert.deepEqual(fixture.calls, ['resize', 'redraw'])
  fixture.cleanup()
  assert.equal(fixture.disconnected(), true)
  fixture.element.clientWidth = 500
  fixture.notify()
  assert.equal(fixture.calls.length, 2)
})

test('Ctrl + колесо над картой отменяет масштабирование страницы, обычное колесо — нет', (t) => {
  const original = globalThis.WheelEvent
  globalThis.WheelEvent = { DOM_DELTA_LINE: 1 }
  t.after(() => {
    if (original === undefined) delete globalThis.WheelEvent
    else globalThis.WheelEvent = original
  })
  assert.equal(mapViewportOptions.scrollZoom, true)
  const handler = new maplibre.ScrollZoomHandler({
    cooperativeGestures: {
      isEnabled: () => mapViewportOptions.cooperativeGestures,
      isBypassed: (event) => event.ctrlKey,
      notifyGestureBlocked: () => {},
    },
  }, () => {})
  handler.enable()
  for (const ctrlKey of [false, true]) {
    const event = new Event('wheel', { cancelable: true })
    Object.assign(event, { ctrlKey, metaKey: false, shiftKey: false, deltaMode: 0, deltaY: 0 })
    handler.wheel(event)
    assert.equal(event.defaultPrevented, ctrlKey)
  }
})
