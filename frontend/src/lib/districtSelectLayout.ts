export function selectMenuHeightClass(panelHeight: number, buttonHeight: number): string {
  const available = panelHeight - buttonHeight - 20
  if (available >= 240) return 'max-h-60'
  if (available >= 176) return 'max-h-44'
  if (available >= 128) return 'max-h-32'
  if (available >= 80) return 'max-h-20'
  return 'max-h-10'
}

export function revealSelectMenu(button: HTMLElement, menu: HTMLElement): void {
  const panel = button.closest<HTMLElement>('[data-scroll-panel]')
  if (!panel) return
  const top = panel.getBoundingClientRect().top + panel.clientTop + 8
  const bottom = top + panel.clientHeight - 16
  const buttonTop = button.getBoundingClientRect().top
  const menuBottom = menu.getBoundingClientRect().bottom
  // Сдвигаем только свою панель, сохраняя кнопку и список в её видимой области.
  const delta = buttonTop < top ? buttonTop - top
    : Math.min(Math.max(0, menuBottom - bottom), buttonTop - top)
  if (!delta) return
  panel.scrollTo({
    top: Math.min(Math.max(0, panel.scrollTop + delta), Math.max(0, panel.scrollHeight - panel.clientHeight)),
    behavior: 'instant',
  })
}
