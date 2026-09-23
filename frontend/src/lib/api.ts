// Все запросы к бэкенду — только через этот файл. Пути относительные: в dev их проксирует Vite, на проде nginx.

export class ApiError extends Error {
  status: number
  requestId?: string

  constructor(message: string, status: number, requestId?: string) {
    super(message)
    this.status = status
    this.requestId = requestId
  }
}

async function parseError(res: Response): Promise<ApiError> {
  const requestId = res.headers.get('X-Request-ID') ?? undefined
  try {
    const body = await res.json()
    const detail = typeof body.detail === 'string' ? body.detail : 'Некорректный запрос'
    return new ApiError(detail, res.status, body.request_id ?? requestId)
  } catch {
    return new ApiError(`Ошибка сервера (${res.status})`, res.status, requestId)
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {}
  let res: Response
  try {
    res = await fetch(path, {
      ...rest,
      headers: { ...(json !== undefined && { 'Content-Type': 'application/json' }), ...rest.headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    })
  } catch {
    throw new ApiError('Нет связи с сервером', 0)
  }
  if (!res.ok) throw await parseError(res)
  return res.json() as Promise<T>
}

/** Стрим с бэкенда (SSE поверх POST, формат app/sse.py). onDelta вызывается на каждый кусочек текста. */
export async function streamSSE(
  path: string,
  body: unknown,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
  callbacks?: { onStatus?: (text: string) => void; onResult?: (value: unknown) => void },
): Promise<void> {
  let res: Response
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    if (signal?.aborted) throw new DOMException('Запрос остановлен', 'AbortError')
    throw new ApiError('Нет связи с сервером', 0)
  }
  if (!res.ok || !res.body) throw await parseError(res)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const requestId = res.headers.get('X-Request-ID') ?? undefined
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) throw new ApiError('Ответ не завершён: соединение прервано. Попробуйте ещё раз', 502, requestId)
      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split(/\r?\n\r?\n/)
      buffer = events.pop() ?? ''
      for (const event of events) {
        const lines = event.split(/\r?\n/).filter((line) => line.startsWith('data:'))
        if (!lines.length) continue
        const data: unknown = JSON.parse(lines.map((line) => line.slice(5).trimStart()).join('\n'))
        if (typeof data !== 'object' || data === null) throw new Error('Invalid SSE')
        if (('delta' in data && typeof data.delta !== 'string')
          || ('status' in data && typeof data.status !== 'string')
          || ('error' in data && typeof data.error !== 'string')
          || ('done' in data && typeof data.done !== 'boolean')
          || ('ping' in data && typeof data.ping !== 'boolean')) throw new Error('Invalid SSE fields')
        if ('error' in data && typeof data.error === 'string') {
          throw new ApiError(data.error, 502, 'request_id' in data && typeof data.request_id === 'string' ? data.request_id : requestId)
        }
        if ('delta' in data && typeof data.delta === 'string') onDelta(data.delta)
        if ('status' in data && typeof data.status === 'string') callbacks?.onStatus?.(data.status)
        if ('result' in data) callbacks?.onResult?.(data.result)
        if ('done' in data && data.done === true) return
      }
    }
  } catch (err) {
    if (signal?.aborted) throw new DOMException('Запрос остановлен', 'AbortError')
    if (err instanceof ApiError) throw err
    throw new ApiError('Ответ не завершён: ошибка передачи данных. Попробуйте ещё раз', 502, requestId)
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

// --- чат ---------------------------------------------------------------------

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export const streamChat = (messages: ChatMessage[], onDelta: (text: string) => void, signal?: AbortSignal) =>
  streamSSE('/api/chat/stream', { messages }, onDelta, signal)

// --- симулятор ---------------------------------------------------------------

export type Decision = { measure_id: string; district_id: string | null }
export type Indicator = { code: string; direction: string; name: string; weight: number; meaning: string }
export type District = {
  id: string; name: string; population_share: number; profile: string; indicators: Record<string, number>
}
export type Measure = {
  id: string; direction: string; name: string; scope: 'district' | 'city'
  cost: number; lag: number; effects: Record<string, number>
}
export type MeasurePreview = { measure_id: string; effect_share: number; effects: Record<string, number> }
export type Dataset = {
  budget: number; decisions_required: number; max_per_direction: number; horizon_quarters: number
  score_formula: { avg_weight: number; min_weight: number; critical_penalty: number }
  critical_threshold: number; directions: { id: string; name: string }[]
  indicators: Indicator[]; districts: District[]; measures: Measure[]
  synergies: { pair: string[]; bonus: Record<string, number> }[]
  incompatibilities: { pair: string[]; same_district_only: boolean; reason: string }[]
}
export type Scenario = {
  cost: number; remaining: number; score: number; d_avg: number; min_d: number; n_crit: number
  districts: { id: string; name: string; score: number; indicators: Record<string, number> }[]
  effects: { measure_id: string; district_id: string; indicator: string; value: number }[]
  synergies: { pair: string[]; district_id: string; indicator: string; bonus: number }[]
}
export type SimConfig = {
  dataset: Dataset; baseline: Scenario; example: Decision[]; llm_mode: 'mock' | 'live'
  measure_previews: MeasurePreview[]
}
export type Evaluation = {
  valid: boolean; violations: { code: string; message: string }[]; result: Scenario | null
}
export const getSimConfig = () => api<SimConfig>('/api/sim/config')
export const evaluateScenario = (decisions: Decision[]) =>
  api<Evaluation>('/api/sim/evaluate', { method: 'POST', json: { decisions } })
export const analyzeScenario = (decisions: Decision[], onDelta: (text: string) => void, signal?: AbortSignal) =>
  streamSSE('/api/sim/analyze', { decisions }, onDelta, signal)

export type Optimum = { decisions: Decision[]; result: Scenario; exact: boolean; evaluated: number }
export const optimizeScenario = (
  decisions: Decision[], onDelta: (text: string) => void, onStatus: (text: string) => void,
  onResult: (value: Optimum) => void, signal?: AbortSignal,
) => streamSSE('/api/sim/optimize', { decisions }, onDelta, signal, {
  onStatus, onResult: (value) => onResult(value as Optimum),
})

// Локальные геослои загружаются только по запросу пользователя.
export type MapLayerId = 'transport_stops' | 'green_spaces' | 'schools_kindergartens' | 'healthcare' | 'road_safety_objects'
export const getMapLayer = (id: MapLayerId, signal?: AbortSignal) =>
  api<import('geojson').FeatureCollection>(`/map/${id}.json`, { signal })
