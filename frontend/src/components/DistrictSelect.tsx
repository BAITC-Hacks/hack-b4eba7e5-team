import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type Ref } from 'react'

type DistrictSelectProps = {
  id?: string
  label: string
  prefix?: string
  value: string
  options: { value: string; label: string; disabled?: boolean }[]
  onChange: (value: string) => void
  buttonRef?: Ref<HTMLButtonElement>
  describedBy?: string
  className?: string
}

export default function DistrictSelect({
  id, label, prefix, value, options, onChange, buttonRef, describedBy, className,
}: DistrictSelectProps) {
  const generatedId = useId()
  const controlId = id ?? `district-select-${generatedId}`
  const listId = `${controlId}-options`
  const wrapper = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const selected = options.findIndex((option) => option.value === value)
  const enabled = options.flatMap((option, index) => option.disabled ? [] : [index])
  const activeOption = options[active]

  useImperativeHandle(buttonRef, () => button.current!, [])

  useEffect(() => {
    if (!open) return
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !wrapper.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [open])

  useLayoutEffect(() => {
    const menu = list.current
    const option = menu?.children[active]
    if (!open || !menu || !(option instanceof HTMLElement)) return
    // Прокручиваем только список, сохраняя положение карты и страницы.
    if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop
    else if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight) {
      menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight
    }
  }, [open, active])

  function show(last = false) {
    setActive(selected >= 0 && !options[selected].disabled ? selected : (last ? enabled.at(-1) : enabled[0]) ?? -1)
    setOpen(true)
    button.current?.focus({ preventScroll: true })
  }

  function choose(index: number) {
    const option = options[index]
    if (!option || option.disabled) return
    setOpen(false)
    button.current?.focus({ preventScroll: true })
    onChange(option.value)
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Tab') { setOpen(false); return }
    if (event.key === 'Escape') {
      if (open) { event.preventDefault(); event.stopPropagation(); setOpen(false) }
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Enter' || event.key === ' ') {
      if (open) choose(active)
      else show()
    } else if (event.key === 'Home' || event.key === 'End') {
      setOpen(true)
      setActive((event.key === 'Home' ? enabled[0] : enabled.at(-1)) ?? -1)
    } else if (!open) show(event.key === 'ArrowUp')
    else if (enabled.length) {
      const position = enabled.indexOf(active)
      const direction = event.key === 'ArrowDown' ? 1 : -1
      const next = position < 0 ? (direction === 1 ? 0 : enabled.length - 1)
        : (position + direction + enabled.length) % enabled.length
      setActive(enabled[next])
    }
  }

  return (
    <div ref={wrapper} className={`relative ${className ?? ''}`} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
    }}>
      <button ref={button} id={controlId} type="button" role="combobox" aria-label={label}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeOption && !activeOption.disabled ? `${listId}-${active}` : undefined}
        aria-describedby={describedBy} onKeyDown={onKeyDown} onClick={() => open ? setOpen(false) : show()}
        className="flex min-h-10 w-full min-w-0 items-center gap-2 border border-slate-300 bg-white px-3 py-2 text-left text-xs text-slate-800 transition-colors hover:border-slate-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 motion-reduce:transition-none">
        {prefix && <span className="shrink-0 text-[11px] font-medium text-slate-500">{prefix}</span>}
        <span className="min-w-0 flex-1 truncate font-semibold">{options[selected]?.label ?? label}</span>
        <svg aria-hidden="true" viewBox="0 0 16 16" className={`size-3.5 shrink-0 fill-none stroke-current stroke-[1.5] transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}>
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {open && <ul ref={list} id={listId} role="listbox" aria-label={label}
        className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-y-auto overscroll-contain border border-slate-300 bg-white p-1 motion-safe:transition-[opacity,translate] motion-safe:duration-150 motion-safe:starting:-translate-y-1 motion-safe:starting:opacity-0">
        {options.map((option, index) => <li key={option.value} id={`${listId}-${index}`} role="option"
          aria-selected={option.value === value} aria-disabled={option.disabled || undefined}
          onPointerDown={(event) => event.preventDefault()}
          onPointerMove={() => { if (!option.disabled && active !== index) setActive(index) }}
          onClick={() => choose(index)}
          className={`flex min-h-10 items-center gap-2 px-2 py-2 text-xs leading-5 transition-colors motion-reduce:transition-none ${option.disabled ? 'cursor-not-allowed text-slate-400' : `cursor-pointer hover:bg-teal-50 ${active === index ? 'bg-teal-50 text-teal-900' : option.value === value ? 'bg-teal-50 text-teal-800' : 'text-slate-700'}`}`}>
          <span className="min-w-0 flex-1">{option.label}</span>
          <span aria-hidden="true" className="w-3 shrink-0 text-teal-700">{option.value === value ? '✓' : ''}</span>
        </li>)}
      </ul>}
    </div>
  )
}
