export const clampScore = (score: number) => Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : 0

// Цвет и заполнение используют одно значение: 0 — красный, 50 — жёлтый, 100 — зелёный.
export function scoreColor(score: number): string {
  const value = clampScore(score)
  const stops = [[239, 68, 68], [250, 204, 21], [34, 197, 94]]
  const segment = value < 50 ? 0 : 1
  const progress = (value - segment * 50) / 50
  const channels = stops[segment].map((channel, index) => (
    Math.round(channel + (stops[segment + 1][index] - channel) * progress)
  ))
  return `rgb(${channels.join(', ')})`
}

export function scoreFrame(score: number, progress: number): number {
  const time = Math.min(1, Math.max(0, progress))
  return clampScore(score) * (1 - (1 - time) ** 3)
}

export function scoreAnimationFrame(score: number, elapsed: number) {
  const countDuration = 1600
  const sparkDuration = 900
  const afterCount = elapsed - countDuration
  return {
    value: scoreFrame(score, elapsed / countDuration),
    sparkProgress: afterCount >= 0 && afterCount < sparkDuration ? afterCount / sparkDuration : null,
    finished: afterCount >= sparkDuration,
  }
}

export function scoreSparks(progress: number) {
  const time = Math.min(1, Math.max(0, progress))
  const spread = 1 - (1 - time) ** 3
  const count = 40
  // Весь круг вспыхивает одновременно, независимо от длины оценочной дуги.
  const origins = Array.from({ length: count }, (_, index) => {
    const angle = Math.PI * 2 * index / count
    return { x: 100 + 88 * Math.cos(angle), y: 100 + 88 * Math.sin(angle), angle }
  })
  return {
    origins,
    opacity: time < 0.12 ? 1 : ((1 - time) / 0.88) ** 1.3,
    glowWidth: 18 + 20 * spread,
    innerRadius: 80 - 30 * spread,
    outerRadius: 88 + 18 * spread,
    particleRadius: 1.8 - time,
    rays: origins.flatMap((origin, index) => Array.from({ length: 4 }, (_, ray) => {
      const inward = ray >= 2
      const direction = origin.angle + (inward ? Math.PI : 0) + (ray % 2 ? 0.3 : -0.3)
      const distance = ((inward ? 26 : 12) + (index * 3 + ray) % 5 * 3) * spread
      const length = (5 + (index + ray) % 3 * 2) * (1 - time * 0.5)
      const dx = Math.cos(direction)
      const dy = Math.sin(direction)
      return {
        x1: origin.x + dx * distance, y1: origin.y + dy * distance,
        x2: origin.x + dx * (distance + length), y2: origin.y + dy * (distance + length),
      }
    })),
  }
}
