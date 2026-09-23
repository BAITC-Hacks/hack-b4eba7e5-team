import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getTourLayout, type TourRect } from '../lib/tour'

const steps = [
  { target: 'map', title: 'Выберите район', text: 'Нажмите на район на карте или выберите его в списке. Цветные кнопки включают слои объектов — можно выбрать несколько.' },
  { target: 'district', title: 'Изучите состояние района', text: 'Здесь видны оценка района и показатели, которым нужно внимание. Раскройте список, чтобы сравнить все показатели.' },
  { target: 'measures', title: 'Выберите меры развития', text: 'Откройте направление и добавьте меры в план. Из одного направления можно выбрать не больше двух мер.' },
  { target: 'plan', title: 'Следите за планом и бюджетом', text: 'В плане должно быть ровно пять разных мер. Здесь можно изменить их районы и проверить расходы. Бюджет — 100 единиц.' },
  { target: 'calculate', title: 'Рассчитайте сценарий', text: 'Когда выбраны пять мер, нажмите «Рассчитать результат». Вы увидите Score и изменения показателей, затем сможете запросить разбор плана.' },
] as const

const emptyRect: TourRect = { x: 0, y: 0, width: 0, height: 0 }
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function GuidedTour({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0)
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)
  const [layout, setLayout] = useState({ spotlight: emptyRect, card: emptyRect })
  const dialog = useRef<HTMLDialogElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const nextButton = useRef<HTMLButtonElement>(null)
  const finish = useRef(onClose)
  const maskId = useId()
  const headingId = useId()
  const textId = useId()
  const current = steps[step]

  useEffect(() => { finish.current = onClose }, [onClose])

  useLayoutEffect(() => {
    const modal = dialog.current
    if (!modal) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const scroll = { left: window.scrollX, top: window.scrollY }
    const wasLocked = document.documentElement.classList.contains('overflow-hidden')
    document.documentElement.classList.add('overflow-hidden')
    modal.showModal()
    const frame = requestAnimationFrame(() => setVisible(true))
    return () => {
      cancelAnimationFrame(frame)
      modal.close()
      if (!wasLocked) document.documentElement.classList.remove('overflow-hidden')
      window.scrollTo({ ...scroll, behavior: 'instant' })
      opener?.focus({ preventScroll: true })
    }
  }, [])

  useLayoutEffect(() => {
    const target = document.querySelector<HTMLElement>(`[data-tour="${current.target}"]`)
    if (!target) { finish.current(); return }
    let frame = 0
    function measure() {
      if (!target) return
      const rect = target.getBoundingClientRect()
      setLayout(getTourLayout(
        { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight },
        { height: card.current ? card.current.scrollHeight + card.current.offsetHeight - card.current.clientHeight : 230 },
      ))
    }
    function scheduleMeasure() {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    // Оставляем место для подсказки на узком экране, не меняя сам сценарий.
    const top = target.getBoundingClientRect().top + window.scrollY - 24
    window.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? 'instant' : 'smooth' })
    measure()
    nextButton.current?.focus({ preventScroll: true })
    const observer = new ResizeObserver(scheduleMeasure)
    observer.observe(target)
    if (card.current) observer.observe(card.current)
    window.addEventListener('scroll', scheduleMeasure, { passive: true })
    window.addEventListener('resize', scheduleMeasure)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('scroll', scheduleMeasure)
      window.removeEventListener('resize', scheduleMeasure)
    }
  }, [current])

  useEffect(() => {
    if (!closing) return
    const timer = setTimeout(() => finish.current(), reducedMotion() ? 0 : 180)
    return () => clearTimeout(timer)
  }, [closing])

  function close() { setVisible(false); setClosing(true) }
  const highlight = layout.spotlight
  const tip = layout.card

  return createPortal(
    <dialog ref={dialog} aria-labelledby={headingId} aria-describedby={textId}
      onCancel={(event) => { event.preventDefault(); close() }}
      className={`fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden border-0 bg-transparent p-0 text-stone-900 outline-none backdrop:bg-transparent motion-safe:transition-opacity motion-safe:duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}>
      <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs><mask id={maskId} maskUnits="userSpaceOnUse">
          <rect width="100%" height="100%" className="fill-white" />
          <rect x={highlight.x} y={highlight.y} width={highlight.width} height={highlight.height} className="fill-black motion-safe:transition-all motion-safe:duration-300 motion-safe:ease-out" />
        </mask></defs>
        <rect width="100%" height="100%" mask={`url(#${maskId})`} className="fill-stone-950/65" />
        <rect x={highlight.x} y={highlight.y} width={highlight.width} height={highlight.height} className="fill-none stroke-teal-400 stroke-2 motion-safe:transition-all motion-safe:duration-300 motion-safe:ease-out" />
      </svg>
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <foreignObject x={tip.x} y={tip.y} width={tip.width} height={tip.height} className="overflow-visible motion-safe:transition-all motion-safe:duration-300 motion-safe:ease-out">
          <div ref={card} className="pointer-events-auto max-h-full overflow-y-auto border border-stone-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between gap-4">
              <p className="text-xs font-medium tabular-nums text-teal-700">{step + 1} из {steps.length}</p>
              <button type="button" onClick={close} aria-label="Закрыть подсказки" className="-m-2 flex size-9 items-center justify-center text-xl text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-900 focus-visible:outline-2 focus-visible:outline-teal-700">×</button>
            </div>
            <div key={step} aria-live="polite" className="motion-safe:transition-[opacity,translate] motion-safe:duration-300 motion-safe:starting:translate-y-1 motion-safe:starting:opacity-0">
              <h2 id={headingId} className="text-base font-semibold leading-6">{current.title}</h2>
              <p id={textId} className="mt-2 text-sm leading-6 text-stone-600">{current.text}</p>
            </div>
            <div className="mt-5 flex gap-2">
              <button type="button" disabled={closing} onClick={() => step === 0 ? close() : setStep(step - 1)} className="min-h-11 flex-1 border border-stone-200 px-3 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-teal-700">
                {step === 0 ? 'Пропустить' : 'Назад'}
              </button>
              <button ref={nextButton} type="button" disabled={closing} onClick={() => step === steps.length - 1 ? close() : setStep(step + 1)} className="min-h-11 flex-1 bg-teal-800 px-3 text-sm font-semibold text-white transition-colors hover:bg-teal-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">
                {step === steps.length - 1 ? 'Начать работу' : 'Далее'}
              </button>
            </div>
          </div>
        </foreignObject>
      </svg>
    </dialog>, document.body,
  )
}
