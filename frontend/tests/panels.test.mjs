import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

async function sourceModule(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
}

const { catalogLimit, catalogWidth, draggedCatalogWidth, MIN_CATALOG_WIDTH, MAX_CATALOG_WIDTH, DEFAULT_CATALOG_WIDTH, PANEL_STEP, MIN_MAP_WIDTH, DIVIDER_WIDTH } = await sourceModule('../src/lib/panels.ts')
const { panelClasses } = await sourceModule('../src/lib/panelClasses.ts')

test('Каталог ограничен по ширине и округляется до шага Tailwind', () => {
  assert.equal(catalogWidth(-100), MIN_CATALOG_WIDTH)
  assert.equal(catalogWidth(9999), MAX_CATALOG_WIDTH)
  assert.equal(catalogWidth(NaN), DEFAULT_CATALOG_WIDTH)
  assert.equal(catalogWidth(Infinity), DEFAULT_CATALOG_WIDTH)
  assert.equal(catalogWidth(301), 300)
  assert.equal(catalogWidth(303), 304)
})

test('Для каждой допустимой ширины есть полный Tailwind-класс', () => {
  assert.equal(panelClasses.length, (MAX_CATALOG_WIDTH - MIN_CATALOG_WIDTH) / PANEL_STEP + 1)
  for (let width = MIN_CATALOG_WIDTH; width <= MAX_CATALOG_WIDTH; width += PANEL_STEP) {
    assert.equal(panelClasses[(width - MIN_CATALOG_WIDTH) / PANEL_STEP], `md:grid-cols-[minmax(0,1fr)_16px_${width}px]`)
  }
})

test('При узком окне карте остаётся не меньше 416 px', () => {
  for (const width of [713, 855, 984, 1001, 1100, 1360, 2152]) {
    const limit = catalogLimit(width)
    assert.ok(limit >= MIN_CATALOG_WIDTH && limit <= MAX_CATALOG_WIDTH)
    assert.ok(width - limit - DIVIDER_WIDTH >= MIN_MAP_WIDTH)
    assert.equal(limit % PANEL_STEP, 0)
    assert.ok(catalogWidth(640, limit) <= limit)
  }
  assert.equal(catalogLimit(NaN), MIN_CATALOG_WIDTH)
})

test('Перетягивание влево расширяет каталог, вправо — карту', () => {
  assert.equal(draggedCatalogWidth(300, 900, 700, 640), 500)
  assert.equal(draggedCatalogWidth(500, 700, 900, 640), 300)
  assert.equal(draggedCatalogWidth(300, 900, -1000, 552), 552)
  assert.equal(draggedCatalogWidth(300, 900, 2000, 640), 280)
})
