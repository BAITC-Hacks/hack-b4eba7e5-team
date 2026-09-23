import SimulatorPage from './pages/SimulatorPage'

export default function App() {
  return (
    <div className="min-h-full bg-stone-50 text-stone-900 antialiased">
      <header className="border-b border-stone-200/80 bg-white">
        <div className="mx-auto flex max-w-[2200px] flex-wrap items-center justify-between gap-3 px-3 py-3 sm:px-5 2xl:px-6">
          <div className="flex items-center gap-2.5">
            <img src="/astana-emblem.svg" alt="Герб Астаны" width="32" height="32" className="size-8 shrink-0 object-contain" />
            <h1 className="text-sm font-semibold tracking-tight">Аким на 5 часов</h1>
          </div>
        </div>
      </header>
      <SimulatorPage />
    </div>
  )
}
