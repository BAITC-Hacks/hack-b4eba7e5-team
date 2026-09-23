import { useEffect, useId, useRef, useState } from 'react'
import { clampScore, scoreAnimationFrame, scoreColor, scoreSparks } from '../lib/score'

const formatScore = (score: number) => score.toLocaleString('ru-RU', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})

export default function ScoreGauge({ score }: { score: number }) {
  const effectId = useId()
  const container = useRef<HTMLDivElement>(null)
  const [displayed, setDisplayed] = useState(0)
  const [sparkProgress, setSparkProgress] = useState<number | null>(null)
  const [replay, setReplay] = useState(0)
  const target = clampScore(score)

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    let started = false
    let observer: IntersectionObserver | undefined

    function finish() {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      setDisplayed(target)
      setSparkProgress(null)
    }

    function start() {
      if (started || preference.matches) return
      started = true
      observer?.disconnect()
      let began: number | undefined
      function tick(now: number) {
        began ??= now
        const next = scoreAnimationFrame(target, now - began)
        setDisplayed(next.value)
        setSparkProgress(next.sparkProgress)
        if (!next.finished) frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
    }

    function onPreferenceChange() {
      if (preference.matches) finish()
    }

    if (preference.matches) finish()
    else if (container.current && 'IntersectionObserver' in window) {
      // Не проигрываем анимацию за экраном: результат может находиться ниже длинного плана.
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.4)) start()
      }, { threshold: 0.4 })
      observer.observe(container.current)
    } else start()

    preference.addEventListener('change', onPreferenceChange)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      preference.removeEventListener('change', onPreferenceChange)
    }
  }, [target, replay])

  const sparks = sparkProgress === null ? null : scoreSparks(sparkProgress)
  const finalColor = scoreColor(target)

  return (
    <div ref={container} className="text-center">
      <div
        role="meter" aria-label="Итоговый Score города" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={target} aria-valuetext={`${formatScore(score)} из 100`}
        className="relative mx-auto mt-4 size-48 max-w-full"
      >
        <svg aria-hidden="true" viewBox="0 0 200 200" className="pointer-events-none size-full -rotate-90 overflow-visible fill-none">
          <defs>
            <radialGradient id={`${effectId}-inner-light`}>
              <stop offset="0%" className="[stop-color:white]" stopOpacity="0.95" />
              <stop offset="38%" className="[stop-color:white]" stopOpacity="0.8" />
              <stop offset="68%" stopColor={finalColor} stopOpacity="0.5" />
              <stop offset="90%" stopColor={finalColor} stopOpacity="0.95" />
              <stop offset="100%" stopColor={finalColor} stopOpacity="0" />
            </radialGradient>
            <filter id={`${effectId}-glow`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" />
            </filter>
          </defs>
          <circle cx="100" cy="100" r="88" strokeWidth="10" className="stroke-stone-200/70" />
          <circle
            cx="100" cy="100" r="88" pathLength="100" strokeWidth="10" strokeLinecap="round"
            stroke={scoreColor(displayed)} strokeDasharray={`${displayed} 100`}
            visibility={displayed > 0 ? 'visible' : 'hidden'}
          />
          {sparks && <g data-testid="score-sparks" stroke={finalColor} opacity={sparks.opacity}>
            <circle
              data-testid="score-inner-flash" cx="100" cy="100" r="84"
              fill={`url(#${effectId}-inner-light)`} className="stroke-none"
            />
            <circle
              cx="100" cy="100" r="88" strokeWidth={sparks.glowWidth}
              opacity="0.7" filter={`url(#${effectId}-glow)`}
            />
            <circle cx="100" cy="100" r="88" strokeWidth="3" className="stroke-white" />
            <circle cx="100" cy="100" r={sparks.innerRadius} strokeWidth="2.5" opacity="0.85" />
            <circle cx="100" cy="100" r={sparks.outerRadius} strokeWidth="1.5" opacity="0.6" />
            {sparks.rays.map((ray, index) => (
              <g key={index}>
                <line {...ray} strokeWidth={index % 4 >= 2 ? 2.5 : 2} strokeLinecap="round" />
                <circle cx={ray.x2} cy={ray.y2} r={sparks.particleRadius} fill={finalColor} className="stroke-none" />
                {index % 2 === 0 && <circle cx={ray.x2} cy={ray.y2} r="0.7" className="fill-white stroke-none" />}
              </g>
            ))}
          </g>}
        </svg>
        <div aria-hidden="true" className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-semibold tracking-tight tabular-nums text-stone-900">{formatScore(displayed)}</span>
          <span className="mt-1 text-xs text-stone-500">из 100</span>
        </div>
      </div>
      <div aria-hidden="true" className="mx-auto mt-3 flex max-w-48 justify-between text-[10px] tabular-nums text-stone-500">
        <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-red-500" />0</span>
        <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-yellow-400" />50</span>
        <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-green-500" />100</span>
      </div>
      <button
        type="button" onClick={() => { setDisplayed(0); setSparkProgress(null); setReplay((value) => value + 1) }}
        className="mt-2 min-h-9 rounded-lg px-3 text-[11px] text-stone-500 underline decoration-stone-300 underline-offset-4 hover:text-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
      >
        Повторить анимацию
      </button>
    </div>
  )
}
