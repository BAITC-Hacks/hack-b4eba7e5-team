export function scrollPanelTo(target: HTMLElement, behavior: ScrollBehavior): boolean {
  const panel = target.closest<HTMLElement>('[data-scroll-panel]')
  if (!panel) return false

  const top = panel.scrollTop + target.getBoundingClientRect().top
    - panel.getBoundingClientRect().top - panel.clientTop - 12
  panel.scrollTo({
    top: Math.min(Math.max(0, top), Math.max(0, panel.scrollHeight - panel.clientHeight)),
    behavior,
  })
  return true
}
