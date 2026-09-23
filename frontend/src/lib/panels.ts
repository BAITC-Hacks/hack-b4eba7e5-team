export const MIN_CATALOG_WIDTH = 280
export const MAX_CATALOG_WIDTH = 640
export const DEFAULT_CATALOG_WIDTH = 300
export const PANEL_STEP = 4
export const DIVIDER_WIDTH = 16
export const MIN_MAP_WIDTH = 416

export function catalogLimit(containerWidth: number): number {
  const available = Number.isFinite(containerWidth) ? containerWidth - DIVIDER_WIDTH - MIN_MAP_WIDTH : 0
  return Math.max(MIN_CATALOG_WIDTH, Math.min(MAX_CATALOG_WIDTH, Math.floor(available / PANEL_STEP) * PANEL_STEP))
}

export function catalogWidth(value: number, limit = MAX_CATALOG_WIDTH): number {
  const safe = Number.isFinite(value) ? value : DEFAULT_CATALOG_WIDTH
  return Math.max(MIN_CATALOG_WIDTH, Math.min(limit, Math.round(safe / PANEL_STEP) * PANEL_STEP))
}

export function draggedCatalogWidth(startWidth: number, startX: number, currentX: number, limit: number): number {
  return catalogWidth(startWidth + startX - currentX, limit)
}
