import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import ScoreGauge from '../src/components/ScoreGauge'
import '../src/index.css'

// Изолированный визуальный тест: не меняет данные симулятора и не вызывает API.
export default function ScorePreview() {
  return (
    <main className="flex min-h-full items-center justify-center bg-stone-50 p-6 text-stone-900">
      <section className="w-full max-w-sm rounded-3xl border border-stone-200 bg-white p-8 text-center shadow-sm">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-red-600">Тест анимации</p>
        <h1 className="mt-2 text-xl font-semibold">Красная шкала</h1>
        <p className="mt-2 text-xs leading-5 text-stone-500">Тестовое значение 10/100 — не результат расчёта города.</p>
        <div className="py-5"><ScoreGauge score={10} /></div>
        <p className="text-xs leading-5 text-stone-500">В конце вспыхнет весь круг: красные искры снаружи и внутри.</p>
        <a href="/" className="mt-5 inline-block rounded-lg px-3 py-2 text-xs font-medium text-teal-800 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">Вернуться к симулятору</a>
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><ScorePreview /></StrictMode>)
