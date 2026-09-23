import type { Dataset, Decision, Measure, MeasurePreview } from '../lib/api'
import { districtDisplayName } from '../lib/districts'

const fmt = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 3 })
const signed = (value: number) => `${value > 0 ? '+' : ''}${fmt(value)}`

export default function MeasureDetails({ measure, preview, dataset, decisions }: {
  measure: Measure; preview: MeasurePreview; dataset: Dataset; decisions: Decision[]
}) {
  const synergies = dataset.synergies.filter((rule) => rule.pair.includes(measure.id))
  const conflicts = dataset.incompatibilities.filter((rule) => rule.pair.includes(measure.id))
  const measureLabel = (id: string) => `${id} · ${dataset.measures.find((item) => item.id === id)?.name ?? id}`
  const indicatorName = (code: string) => dataset.indicators.find((item) => item.code === code)?.name ?? code

  return (
    <div className="mt-2 text-[11px] leading-5">
      <p className="text-stone-500">{measure.id} · Лаг {measure.lag} кв. из {dataset.horizon_quarters}</p>
      <p className="text-stone-500">За {dataset.horizon_quarters} кв. учтено {fmt(preview.effect_share * 100)}% полного эффекта:</p>
      <ul className="mt-1 space-y-1">
        {Object.entries(preview.effects).map(([code, value]) => (
          <li key={code} className={`flex justify-between gap-2 ${value < 0 ? 'text-amber-800' : 'text-teal-800'}`}>
            <span>{indicatorName(code)} <span className="text-stone-400">{code}</span></span>
            <span className="shrink-0 font-semibold tabular-nums">{signed(value)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[10px] leading-4 text-stone-400">
        {measure.scope === 'city' ? 'В каждом из пяти районов.' : 'Только в назначенном районе.'} Бонусы отдельно; показатели ограничены 0–100.
      </p>
      {(synergies.length > 0 || conflicts.length > 0) && (
        <details className="mt-2 border-t border-stone-200/70 pt-1">
          <summary className="cursor-pointer rounded py-1 font-medium text-stone-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">
            Бонусы и ограничения
          </summary>
          {synergies.map((rule) => {
            const bothSelected = rule.pair.every((id) => decisions.some((item) => item.measure_id === id))
            const target = decisions.find((item) => item.measure_id === rule.pair[0])?.district_id
            const targetDistrict = dataset.districts.find((item) => item.id === target)
            const targetName = targetDistrict ? districtDisplayName(targetDistrict.id, targetDistrict.name) : undefined
            const partner = rule.pair.find((id) => id !== measure.id)!
            return (
              <div key={rule.pair.join('-')} className="mt-2 text-teal-800">
                <p className="font-medium">{bothSelected ? 'Пара в плане' : 'Бонус при выборе пары'}: {rule.pair.join(' + ')}</p>
                <p>Совместно с {measureLabel(partner)}.</p>
                <p>{Object.entries(rule.bonus).map(([code, bonus]) => `${indicatorName(code)} ${signed(bonus)}`).join(', ')} — {targetName ?? `в районе меры ${rule.pair[0]}`}.</p>
                <p className="text-[10px]">Бонус целиком, без уменьшения по лагу; применяется при расчёте допустимого плана.</p>
              </div>
            )
          })}
          {conflicts.map((rule) => (
            <p key={rule.pair.join('-')} className="mt-2 text-amber-800">
              {rule.pair.join(' + ')}: {rule.reason}.
            </p>
          ))}
        </details>
      )}
    </div>
  )
}
