import { useEffect, useRef, useState } from 'react'
import { ApiError, streamChat, type ChatMessage } from '../lib/api'

// Экран чата со стримингом ответа. Образец экрана: состояния «пусто», «загрузка», «ошибка».
export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    const history: ChatMessage[] = [...messages, { role: 'user', content: text }]
    setMessages([...history, { role: 'assistant', content: '' }])
    setInput('')
    setError(null)
    setBusy(true)
    try {
      await streamChat(history, (delta) =>
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          next[next.length - 1] = { ...last, content: last.content + delta }
          return next
        }),
      )
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('Что-то пошло не так', 0))
      setMessages(history) // убираем пустой ответ ассистента
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && <p className="mt-20 text-center text-slate-400">Напишите что-нибудь</p>}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 ${
                m.role === 'user' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white'
              }`}
            >
              {m.content || '…'}
            </div>
          </div>
        ))}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {error.message}
            {error.requestId && <span className="ml-2 text-red-400">#{error.requestId}</span>}
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      <form onSubmit={send} className="border-t border-slate-200 bg-white p-4">
        <div className="mx-auto flex max-w-3xl gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Сообщение…"
            className="flex-1 rounded-xl border border-slate-300 px-4 py-2 outline-none focus:border-slate-500"
          />
          <button
            disabled={busy || !input.trim()}
            className="rounded-xl bg-slate-900 px-5 py-2 font-medium text-white disabled:opacity-40"
          >
            {busy ? '…' : 'Отправить'}
          </button>
        </div>
      </form>
    </>
  )
}
