import { useState } from 'react'
import SimulatorPage from './pages/SimulatorPage'

export default function App() {
  const [actionsContainer, setActionsContainer] = useState<HTMLDivElement | null>(null)

  return (
    <div className="flex min-h-dvh flex-col bg-stone-50 text-stone-900 antialiased md:h-dvh md:min-h-[640px] md:overflow-hidden">
      <header className="shrink-0 border-b border-stone-200/80 bg-white">
        <div className="mx-auto flex max-w-[2200px] flex-wrap items-center justify-between gap-3 px-3 py-2 sm:px-5 2xl:px-6">
          <div className="flex items-center gap-2.5">
            <img src="/astana-emblem.svg" alt="Герб Астаны" width="32" height="32" className="size-8 shrink-0 object-contain" />
            <h1 className="text-sm font-semibold tracking-tight">Аким на 5 часов</h1>
          </div>
          <div ref={setActionsContainer} className="flex min-h-10 items-center" />
        </div>
      </header>
      <SimulatorPage actionsContainer={actionsContainer} />
    </div>
  )
}
