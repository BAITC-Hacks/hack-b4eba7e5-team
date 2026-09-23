export type TourRect = { x: number; y: number; width: number; height: number }

const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

export function getTourSpotlight(
  target: TourRect,
  viewport: { width: number; height: number },
  panel?: TourRect,
): TourRect {
  const viewportWidth = Math.max(0, finite(viewport.width))
  const viewportHeight = Math.max(0, finite(viewport.height))
  const spotlightMarginX = Math.min(8, viewportWidth / 2)
  const spotlightMarginY = Math.min(8, viewportHeight / 2)
  const minX = panel ? clamp(finite(panel.x), spotlightMarginX, viewportWidth - spotlightMarginX) : spotlightMarginX
  const minY = panel ? clamp(finite(panel.y), spotlightMarginY, viewportHeight - spotlightMarginY) : spotlightMarginY
  const maxX = panel
    ? clamp(finite(panel.x) + Math.max(0, finite(panel.width)), minX, viewportWidth - spotlightMarginX)
    : viewportWidth - spotlightMarginX
  const maxY = panel
    ? clamp(finite(panel.y) + Math.max(0, finite(panel.height)), minY, viewportHeight - spotlightMarginY)
    : viewportHeight - spotlightMarginY
  const left = clamp(finite(target.x) - 6, minX, maxX)
  const top = clamp(finite(target.y) - 6, minY, maxY)
  const right = clamp(
    finite(target.x) + Math.max(0, finite(target.width)) + 6,
    minX,
    maxX,
  )
  const bottom = clamp(
    finite(target.y) + Math.max(0, finite(target.height)) + 6,
    minY,
    maxY,
  )
  return { x: left, y: top, width: right - left, height: bottom - top }
}
