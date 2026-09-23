import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/api.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})
const { ApiError, streamSSE } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)
const encoder = new TextEncoder()

function serve(t, chunks, options = {}) {
  let cancelled = false
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk)
      if (!options.keepOpen) controller.close()
    },
    cancel() { cancelled = true },
  }), { headers: { 'Content-Type': 'text/event-stream', 'X-Request-ID': 'stream-test' } }))
  return () => cancelled
}

test('SSE сохраняет русский текст при разрыве UTF-8 и границ событий', async (t) => {
  const bytes = encoder.encode('data: {"delta":"Привет"}\n\ndata: {"delta":" мир"}\n\ndata: {"done":true}\n\n')
  serve(t, Array.from(bytes, (byte) => Uint8Array.of(byte)))
  let answer = ''
  await streamSSE('/api/sim/analyze', { decisions: [] }, (delta) => { answer += delta })
  assert.equal(answer, 'Привет мир')
})

test('SSE принимает CRLF, heartbeat и успешное завершение', async (t) => {
  serve(t, [': heartbeat\r\ndata: {"ping":true}\r\n\r\ndata: {"delta":"Ответ"}\r\n\r\ndata: {"done":true}\r\n\r\n'])
  let answer = ''
  await streamSSE('/api/sim/analyze', {}, (delta) => { answer += delta })
  assert.equal(answer, 'Ответ')
})

test('SSE сохраняет status/result советника и многострочное data', async (t) => {
  serve(t, [
    'data: {"status":"Считаем"}\n\ndata: {"ping":true}\n\n',
    'data: {"result":\ndata: {"score":57.236735}}\n\ndata: {"delta":"Готово"}\n\ndata: {"done":true}\n\n',
  ])
  const events = []
  await streamSSE('/api/sim/optimize', {}, (delta) => events.push(['delta', delta]), undefined, {
    onStatus: (value) => events.push(['status', value]),
    onResult: (value) => events.push(['result', value]),
  })
  assert.deepEqual(events, [['status', 'Считаем'], ['result', { score: 57.236735 }], ['delta', 'Готово']])
})

test('SSE отклоняет EOF после частичного ответа без done', async (t) => {
  serve(t, ['data: {"delta":"Начало ответа"}\n\n'])
  let answer = ''
  await assert.rejects(streamSSE('/api/sim/analyze', {}, (delta) => { answer += delta }), ApiError)
  assert.equal(answer, 'Начало ответа')
})

test('SSE отклоняет пустой поток и незавершённое событие done', async (t) => {
  for (const chunks of [[], ['data: {"done":true}']]) {
    serve(t, chunks)
    await assert.rejects(streamSSE('/api/sim/analyze', {}, () => {}), ApiError)
    t.mock.restoreAll()
  }
})

test('SSE не засчитывает done:false как успешное завершение', async (t) => {
  serve(t, ['data: {"delta":"Часть"}\n\ndata: {"done":false}\n\n'])
  await assert.rejects(streamSSE('/api/sim/analyze', {}, () => {}), ApiError)
})

test('SSE сохраняет текст серверной ошибки и request_id', async (t) => {
  serve(t, ['data: {"delta":"Часть"}\n\ndata: {"error":"Провайдер недоступен","request_id":"provider-test"}\n\n'])
  await assert.rejects(streamSSE('/api/sim/analyze', {}, () => {}), (error) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.message, 'Провайдер недоступен')
    assert.equal(error.requestId, 'provider-test')
    return true
  })
})

test('SSE преобразует повреждённый JSON в понятную ошибку API', async (t) => {
  serve(t, ['data: {broken}\n\n'])
  await assert.rejects(streamSSE('/api/sim/analyze', {}, () => {}), ApiError)
})

test('SSE отвергает delta неверного типа', async (t) => {
  serve(t, ['data: {"delta":{"text":"подмена"}}\n\ndata: {"done":true}\n\n'])
  await assert.rejects(streamSSE('/api/sim/analyze', {}, () => assert.fail('Невалидный delta попал в UI')), ApiError)
})

test('SSE завершает чтение на done и освобождает открытый поток', { timeout: 1500 }, async (t) => {
  const cancelled = serve(t, ['data: {"delta":"Готово"}\n\ndata: {"done":true}\n\n'], { keepOpen: true })
  let answer = ''
  await streamSSE('/api/sim/analyze', {}, (delta) => { answer += delta })
  assert.equal(answer, 'Готово')
  assert.equal(cancelled(), true)
})

test('SSE не маскирует сетевой обрыв во время чтения под успех', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) { controller.error(new TypeError('socket closed')) },
  })))
  await assert.rejects(streamSSE('/api/sim/analyze', {}, () => {}), ApiError)
})

test('SSE сохраняет HTTP 429 и request_id при ограничении частоты', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ detail: 'Повторите через минуту' }), {
    status: 429, headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'limit-test' },
  }))
  await assert.rejects(streamSSE('/api/sim/analyze', {}, () => {}), (error) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.status, 429)
    assert.equal(error.requestId, 'limit-test')
    assert.equal(error.message, 'Повторите через минуту')
    return true
  })
})

test('SSE отмена пользователем не выдаёт ошибку соединения', async (t) => {
  const controller = new AbortController()
  controller.abort()
  t.mock.method(globalThis, 'fetch', async () => { throw new DOMException('Aborted', 'AbortError') })
  await assert.rejects(
    streamSSE('/api/sim/analyze', {}, () => assert.fail('Отменённый запрос дал текст'), controller.signal),
    (error) => error.name === 'AbortError' && !(error instanceof ApiError),
  )
})
