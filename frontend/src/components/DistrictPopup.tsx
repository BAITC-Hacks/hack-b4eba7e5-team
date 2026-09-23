import type { Dataset, Scenario } from '../lib/api'
import { districtDisplayName } from '../lib/districts'

const fmt = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })

export default function DistrictPopup({ district, dataset, hasResult, onClose, onFullFormat }: {
  district: Scenario['districts'][number]
  dataset: Dataset
  hasResult: boolean
  onClose: () => void
  onFullFormat: () => void
}) {
  return (
    <section
      role="dialog" aria-modal="false" aria-labelledby="district-popup-title"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      className="max-h-[400px] w-[min(300px,calc(100vw-56px))] overflow-y-auto overscroll-contain rounded-2xl border border-teal-100 bg-white/95 font-sans leading-4 text-stone-800 shadow-xl shadow-teal-950/15 backdrop-blur-md motion-safe:transition-[opacity,transform] motion-safe:duration-300 motion-safe:ease-out motion-safe:starting:scale-95 motion-safe:starting:opacity-0"
    >
      <div className="flex items-start justify-between gap-2 px-4 pt-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-teal-700">Район на карте</p>
          <h3 id="district-popup-title" className="mt-0.5 text-base leading-5 font-semibold">{districtDisplayName(district.id, district.name)}</h3>
        </div>
        <button type="button" onClick={() => { onClose(); document.getElementById('map-district-select')?.focus({ preventScroll: true }) }} aria-label="Закрыть статистику района"
          className="-mr-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-xl text-stone-400 hover:bg-stone-100 hover:text-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <p className="flex items-center justify-between px-4 pt-1 text-[11px] text-stone-500">
        Оценка района <strong className="text-lg leading-6 font-semibold tabular-nums text-teal-800">{fmt(district.score)}</strong>
      </p>
      <p className="px-4 pb-1 text-[10px] text-stone-500">
        {hasResult ? `После вашего плана · ${dataset.horizon_quarters} кварталов` : 'Исходные показатели · от 0 до 100'}
      </p>
      <dl className="divide-y divide-stone-100 px-4">
        {dataset.directions.map((direction) => (
          <div key={direction.id} className="flex items-center justify-between gap-2 py-1">
            <dt className="text-xs font-medium">{direction.name}</dt>
            <dd className="flex shrink-0 gap-1">
              {dataset.indicators.filter((item) => item.direction === direction.id).map((indicator) => {
                const value = district.indicators[indicator.code]
                const critical = value < dataset.critical_threshold
                return (
                  <span key={indicator.code} title={`${indicator.name}${critical ? ' — критический показатель' : ''}`}
                    aria-label={`${indicator.name}: ${fmt(value)}${critical ? ', критический показатель' : ''}`}
                    className={`rounded-md px-1.5 py-0.5 text-[11px] tabular-nums ${critical ? 'bg-amber-50 text-amber-800' : 'bg-stone-50 text-stone-600'}`}>
                    {indicator.code} <strong className="font-semibold">{fmt(value)}</strong>
                  </span>
                )
              })}
            </dd>
          </div>
        ))}
      </dl>
      <div className="px-4 pb-3 pt-2">
        <p className="mb-2 text-[10px] leading-4 text-stone-500">Выше — лучше. Ниже {dataset.critical_threshold} — критично.</p>
        <button type="button" aria-controls="district-statistics" onClick={() => { onClose(); onFullFormat() }}
          className="flex min-h-11 w-full items-center justify-between rounded-xl bg-teal-800 px-3 text-xs font-semibold text-white hover:bg-teal-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 motion-safe:transition-colors">
          Полный формат <span aria-hidden="true">↓</span>
        </button>
      </div>
    </section>
  )
}
