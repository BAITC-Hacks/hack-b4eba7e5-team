import SimulatorPage from './pages/SimulatorPage'

export default function App() {
  return (
    <div className="min-h-full bg-stone-50 text-stone-900 antialiased">
      <header className="border-b border-stone-200/80 bg-white">
        <div className="mx-auto flex max-w-[2200px] flex-wrap items-center justify-between gap-3 px-3 py-3 sm:px-5 2xl:px-6">
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-none bg-teal-800 text-white">
              <svg viewBox="0 0 24 24" fill="none" className="size-5"><path d="M4 19V9h5v10m0 0V5h6v14m0 0v-7h5v7M3 19h18M12 2v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <h1 className="text-sm font-semibold tracking-tight">Аким на 5 часов</h1>
          </div>
        </div>
      </header>
      <SimulatorPage />
    </div>
  )
}
