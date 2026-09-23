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
    if (signal?.aborted) return
    throw new ApiError('Нет связи с сервером', 0)
  }
  if (!res.ok || !res.body) throw await parseError(res)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''
    for (const event of events) {
      const line = event.trim()
      if (!line.startsWith('data:')) continue
      const data = JSON.parse(line.slice(5))
      if (data.error) throw new ApiError(data.error, 502, data.request_id)
      if (data.delta) onDelta(data.delta)
    }
  }
}

// --- чат ---------------------------------------------------------------------

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export const streamChat = (messages: ChatMessage[], onDelta: (text: string) => void, signal?: AbortSignal) =>
  streamSSE('/api/chat/stream', { messages }, onDelta, signal)
