import { useEffect, useState } from 'react'
import { api } from './lib/api'
import SimulatorPage from './pages/SimulatorPage'

type Health = { status: string; env: string; llm: 'mock' | 'live' }

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)

  useEffect(() => {
    api<Health>('/api/health')
      .then(setHealth)
      .catch(() => setHealth(null))
  }, [])

  return (
    <div className="min-h-full bg-stone-50 text-stone-900 antialiased">
      <header className="border-b border-stone-200/80 bg-white/90">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-3 px-3 py-3 sm:px-6 2xl:px-8">
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-xl bg-teal-800 text-white">
              <svg viewBox="0 0 24 24" fill="none" className="size-5"><path d="M4 19V9h5v10m0 0V5h6v14m0 0v-7h5v7M3 19h18M12 2v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <h1 className="text-sm font-semibold tracking-tight">Аким на 5 часов</h1>
            <span className="hidden border-l border-stone-200 pl-3 text-xs text-stone-400 sm:block">Астана</span>
          </div>
          <span className="flex items-center gap-1.5 text-[10px] text-stone-400 sm:text-xs">
            <span aria-hidden="true" className={`size-1.5 rounded-full ${health ? 'bg-teal-500' : 'bg-stone-300'}`} />
            {health ? `ИИ: ${health.llm === 'mock' ? 'шаблонный режим' : 'подключён'}` : 'Подключение к серверу…'}
          </span>
        </div>
      </header>
      <SimulatorPage />
    </div>
  )
}
