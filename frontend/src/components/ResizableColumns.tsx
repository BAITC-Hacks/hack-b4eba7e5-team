import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { catalogLimit, catalogWidth, DEFAULT_CATALOG_WIDTH, draggedCatalogWidth, MAX_CATALOG_WIDTH, MIN_CATALOG_WIDTH, PANEL_STEP } from '../lib/panels'
import { panelClasses } from '../lib/panelClasses'

type Drag = { pointerId: number; startX: number; startWidth: number }

export default function ResizableColumns({ children }: { children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null)
  const separator = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const frame = useRef(0)
  const [width, setWidth] = useState(DEFAULT_CATALOG_WIDTH)
  const [limit, setLimit] = useState(MAX_CATALOG_WIDTH)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const element = container.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      if (!window.matchMedia('(min-width: 48rem)').matches) return
      const nextLimit = catalogLimit(element.clientWidth)
      setLimit(nextLimit)
      setWidth((current) => catalogWidth(current, nextLimit))
    })
    observer.observe(element)
    return () => { observer.disconnect(); cancelAnimationFrame(frame.current) }
  }, [])

  function finish(cancel = false) {
    const active = drag.current
    drag.current = null
    cancelAnimationFrame(frame.current)
    setDragging(false)
    if (cancel && active) setWidth(catalogWidth(active.startWidth, limit))
    if (active && separator.current?.hasPointerCapture(active.pointerId)) separator.current.releasePointerCapture(active.pointerId)
  }

  function move(event: PointerEvent<HTMLDivElement>, final = false) {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    const next = draggedCatalogWidth(active.startWidth, active.startX, event.clientX, limit)
    cancelAnimationFrame(frame.current)
    if (final) { setWidth(next); finish() }
    else frame.current = requestAnimationFrame(() => setWidth(next))
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && drag.current) { event.preventDefault(); finish(true); return }
    const next = { ArrowLeft: width + 20, ArrowRight: width - 20, Home: MIN_CATALOG_WIDTH, End: limit, Enter: DEFAULT_CATALOG_WIDTH }[event.key]
    if (next === undefined) return
    event.preventDefault()
    setWidth(catalogWidth(next, limit))
  }

  return (
    <div ref={container} data-testid="resizable-columns"
      className={`grid min-h-0 flex-1 gap-4 md:grid-rows-[minmax(0,1fr)] md:gap-x-0 ${panelClasses[(width - MIN_CATALOG_WIDTH) / PANEL_STEP]} ${dragging ? 'cursor-col-resize select-none [&_*]:cursor-col-resize' : ''}`}>
      {children}
      <div ref={separator} role="separator" tabIndex={0} aria-label="Ширина каталога мероприятий" aria-orientation="vertical"
        aria-controls="decisions-panel" aria-valuemin={MIN_CATALOG_WIDTH} aria-valuemax={limit} aria-valuenow={width} aria-valuetext={`${width} пикселей`}
        aria-describedby="panel-resize-hint" title="Потяните влево или вправо. Двойной щелчок — исходная ширина."
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary || drag.current) return
          event.preventDefault()
          event.currentTarget.focus({ preventScroll: true })
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width }
          setDragging(true)
        }}
        onPointerMove={move} onPointerUp={(event) => move(event, true)} onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish()}
        onKeyDown={onKeyDown} onDoubleClick={() => setWidth(catalogWidth(DEFAULT_CATALOG_WIDTH, limit))}
        className={`group relative col-start-2 row-start-1 hidden h-full min-h-0 touch-none cursor-col-resize justify-center outline-none md:flex ${dragging ? 'bg-teal-100' : 'hover:bg-teal-50 focus-visible:bg-teal-50'}`}>
        <span aria-hidden="true" className={`absolute inset-y-0 w-px ${dragging ? 'bg-teal-600' : 'bg-stone-200 group-hover:bg-teal-500 group-focus-visible:bg-teal-600'}`} />
        <span aria-hidden="true" className={`absolute top-1/2 flex h-14 w-3.5 -translate-y-1/2 items-center justify-center rounded-full border ${dragging ? 'border-teal-600 bg-teal-100' : 'border-stone-300 bg-white group-hover:border-teal-500 group-focus-visible:border-teal-600'}`}>
          <span className="h-5 w-1 border-x border-teal-700" />
        </span>
        <span id="panel-resize-hint" className="sr-only">Тяните влево, чтобы расширить каталог, вправо — карту. Стрелки меняют ширину, Home и End — пределы, Enter — сброс, Escape — отмена перетягивания.</span>
      </div>
    </div>
  )
}
