import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/districtSelectLayout.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})
const { selectMenuHeightClass, revealSelectMenu } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)

function fixture({ buttonTop = 740, menuBottom = 990, ...properties } = {}) {
  const calls = []
  const panel = {
    scrollTop: 300, clientTop: 1, clientHeight: 600, scrollHeight: 2400,
    getBoundingClientRect: () => ({ top: 200 }),
    scrollTo: (options) => calls.push(options),
    ...properties,
  }
  const button = {
    closest: (selector) => {
      assert.equal(selector, '[data-scroll-panel]')
      return panel
    },
    getBoundingClientRect: () => ({ top: buttonTop }),
  }
  const menu = { getBoundingClientRect: () => ({ bottom: menuBottom }) }
  return { button, menu, calls }
}

test('Высота списка оставляет место кнопке и отступам в компактной панели', () => {
  assert.equal(selectMenuHeightClass(600, 40), 'max-h-60')
  assert.equal(selectMenuHeightClass(260, 40), 'max-h-44')
  assert.equal(selectMenuHeightClass(220, 40), 'max-h-32')
  assert.equal(selectMenuHeightClass(160, 40), 'max-h-20')
  assert.equal(selectMenuHeightClass(120, 40), 'max-h-10')
})

test('Прокрутка ровно на перекрытую часть списка, без изменения соседней панели', () => {
  const current = fixture()
  const other = fixture()
  revealSelectMenu(current.button, current.menu)
  assert.deepEqual(current.calls, [{ top: 497, behavior: 'instant' }])
  assert.deepEqual(other.calls, [])
})

test('Видимые кнопка и список не вызывают лишнюю прокрутку', () => {
  const { button, menu, calls } = fixture({ buttonTop: 300, menuBottom: 550 })
  revealSelectMenu(button, menu)
  assert.deepEqual(calls, [])
})

test('Скрытая сверху кнопка возвращается в область панели', () => {
  const { button, menu, calls } = fixture({ buttonTop: 150, menuBottom: 400 })
  revealSelectMenu(button, menu)
  assert.deepEqual(calls, [{ top: 241, behavior: 'instant' }])
})

test('Прокрутка ограничена границами панели и не вытесняет кнопку вверх', () => {
  const short = fixture({ buttonTop: 220, menuBottom: 600, clientHeight: 240 })
  revealSelectMenu(short.button, short.menu)
  assert.deepEqual(short.calls, [{ top: 311, behavior: 'instant' }])
  const bottom = fixture({ scrollTop: 1790 })
  revealSelectMenu(bottom.button, bottom.menu)
  assert.deepEqual(bottom.calls, [{ top: 1800, behavior: 'instant' }])
})

test('Без панели список не меняет прокрутку страницы', () => {
  revealSelectMenu({ closest: () => null }, {})
})
