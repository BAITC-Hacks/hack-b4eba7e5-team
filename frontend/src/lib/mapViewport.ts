import type { Map, MapOptions } from 'maplibre-gl'

export const mapViewportOptions = {
  // Размер обновляем перед отрисовкой кадра, без второго обработчика MapLibre с задержкой.
  trackResize: false,
  cooperativeGestures: true,
  scrollZoom: true,
  locale: {
    'CooperativeGesturesHandler.WindowsHelpText': 'Удерживайте Ctrl и прокручивайте колёсико для масштаба карты',
    'CooperativeGesturesHandler.MacHelpText': 'Удерживайте ⌘ и прокручивайте для масштаба карты',
    'CooperativeGesturesHandler.MobileHelpText': 'Для перемещения карты используйте два пальца',
  },
} satisfies Partial<MapOptions>

export function observeMapSize(map: Pick<Map, 'resize' | 'redraw'>, element: HTMLElement): () => void {
  let width = element.clientWidth
  let height = element.clientHeight
  let active = true
  const observer = new ResizeObserver(() => {
    if (!active) return
    const nextWidth = element.clientWidth
    const nextHeight = element.clientHeight
    if (nextWidth <= 0 || nextHeight <= 0 || (width === nextWidth && height === nextHeight)) return
    width = nextWidth
    height = nextHeight
    // Не меняем камеру; синхронная отрисовка убирает пустой кадр после изменения canvas.
    map.resize()
    map.redraw()
  })
  observer.observe(element)
  return () => { active = false; observer.disconnect() }
}
