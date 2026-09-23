export type TourRect = { x: number; y: number; width: number; height: number }

const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

export function getTourLayout(
  target: TourRect,
  viewport: { width: number; height: number },
  card: { height: number },
): { spotlight: TourRect; card: TourRect } {
  const viewportWidth = Math.max(0, finite(viewport.width))
  const viewportHeight = Math.max(0, finite(viewport.height))
  const spotlightMarginX = Math.min(8, viewportWidth / 2)
  const spotlightMarginY = Math.min(8, viewportHeight / 2)
  const left = clamp(finite(target.x) - 6, spotlightMarginX, viewportWidth - spotlightMarginX)
  const top = clamp(finite(target.y) - 6, spotlightMarginY, viewportHeight - spotlightMarginY)
  const right = clamp(
    finite(target.x) + Math.max(0, finite(target.width)) + 6,
    spotlightMarginX,
    viewportWidth - spotlightMarginX,
  )
  const bottom = clamp(
    finite(target.y) + Math.max(0, finite(target.height)) + 6,
    spotlightMarginY,
    viewportHeight - spotlightMarginY,
  )
  const spotlight = { x: left, y: top, width: right - left, height: bottom - top }
  const marginX = Math.min(12, viewportWidth / 2)
  const marginY = Math.min(12, viewportHeight / 2)
  const width = Math.min(320, viewportWidth - 2 * marginX)
  const height = Math.min(Math.max(0, finite(card.height)), viewportHeight - 2 * marginY)
  const centeredX = left + (spotlight.width - width) / 2
  const centeredY = top + (spotlight.height - height) / 2
  const candidates = [
    { x: right + 14, y: centeredY },
    { x: left - width - 14, y: centeredY },
    { x: centeredX, y: bottom + 14 },
    { x: centeredX, y: top - height - 14 },
  ].map(({ x, y }) => ({
    x: clamp(x, marginX, viewportWidth - marginX - width),
    y: clamp(y, marginY, viewportHeight - marginY - height),
    width,
    height,
  }))
  const overlap = (candidate: TourRect) => (
    Math.max(0, Math.min(right, candidate.x + width) - Math.max(left, candidate.x))
    * Math.max(0, Math.min(bottom, candidate.y + height) - Math.max(top, candidate.y))
  )
  // При тесном экране оставляем карточку доступной и перекрываем минимум подсветки.
  const placement = candidates.reduce((best, candidate) => (
    overlap(candidate) < overlap(best) ? candidate : best
  ))
  return { spotlight, card: placement }
}
