import { useEffect, useState } from 'react'
import { api } from './lib/api'
import ChatPage from './pages/ChatPage'

type Health = { status: string; env: string; llm: 'mock' | 'live' }

// Каркас страницы: шапка со статусом API и текущий экран.
export default function App() {
  const [health, setHealth] = useState<Health | null>(null)

  useEffect(() => {
    api<Health>('/api/health')
      .then(setHealth)
      .catch(() => setHealth(null))
  }, [])

  return (
    <div className="flex h-full flex-col bg-slate-50 text-slate-900">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <h1 className="text-lg font-semibold">HackAlem</h1>
        <span className="text-xs text-slate-500">
          {health ? `API ok · LLM: ${health.llm}` : 'API недоступен'}
        </span>
      </header>
      <ChatPage />
    </div>
  )
}
