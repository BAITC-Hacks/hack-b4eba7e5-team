import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/scrollPanel.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})
const { scrollPanelTo } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)

function fixture({ targetTop = 800, panelTop = 100, ...properties } = {}) {
  const calls = []
  const panel = {
    scrollTop: 200, clientTop: 2, scrollHeight: 2000, clientHeight: 500,
    getBoundingClientRect: () => ({ top: panelTop }),
    scrollTo: (options) => calls.push(options),
    ...properties,
  }
  const target = {
    closest: (selector) => {
      assert.equal(selector, '[data-scroll-panel]')
      return panel
    },
    getBoundingClientRect: () => ({ top: targetTop }),
  }
  return { panel, target, calls }
}

test('Прокрутка панели учитывает её текущую позицию, границу и отступ 12px', () => {
  const { target, calls } = fixture()
  assert.equal(scrollPanelTo(target, 'smooth'), true)
  assert.deepEqual(calls, [{ top: 886, behavior: 'smooth' }])
})

test('Позиция панели ограничена её началом и концом', () => {
  for (const [targetTop, top] of [[-300, 0], [3000, 1500]]) {
    const { target, calls } = fixture({ targetTop })
    scrollPanelTo(target, 'instant')
    assert.deepEqual(calls, [{ top, behavior: 'instant' }])
  }
  const { target, calls } = fixture({ scrollHeight: 300, clientHeight: 500 })
  scrollPanelTo(target, 'auto')
  assert.deepEqual(calls, [{ top: 0, behavior: 'auto' }])
})

test('Отсутствие панели не вызывает прокрутку страницы', () => {
  assert.equal(scrollPanelTo({ closest: () => null }, 'smooth'), false)
})

test('Изменение позиции страницы не влияет на конечную позицию внутри панели', () => {
  const first = fixture()
  const second = fixture({ targetTop: 480, panelTop: -220 })
  scrollPanelTo(first.target, 'smooth')
  scrollPanelTo(second.target, 'smooth')
  assert.deepEqual(first.calls, second.calls)
})

test('Прокручивается только ближайшая панель, горизонтальная позиция не меняется', () => {
  const first = fixture()
  const second = fixture()
  scrollPanelTo(first.target, 'smooth')
  assert.equal(first.calls.length, 1)
  assert.equal(second.calls.length, 0)
  assert.equal('left' in first.calls[0], false)
})
