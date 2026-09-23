import { useEffect, useState } from 'react'
import { api } from './lib/api'
import SimulatorPage from './pages/SimulatorPage'

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
    <div className="min-h-full bg-slate-50 text-slate-900">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <h1 className="text-lg font-semibold">Аким на 5 часов</h1>
        <span className="text-xs text-slate-500">
          {health ? `Рабочий прототип · ИИ: ${health.llm === 'mock' ? 'шаблонный режим' : 'API'}` : 'Проверяем связь с сервером…'}
        </span>
      </header>
      <SimulatorPage />
    </div>
  )
}
