import { useEffect, useRef, useState } from 'react'
import {
  ApiError, analyzeScenario, evaluateScenario, getSimConfig,
  type Decision, type Evaluation, type SimConfig,
} from '../lib/api'

const fmt = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
const signed = (value: number) => `${value > 0 ? '+' : ''}${fmt(value)}`
const toError = (err: unknown) => err instanceof ApiError ? err : new ApiError('Не удалось выполнить запрос', 0)

function ErrorMessage({ error }: { error: ApiError }) {
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      {error.message}
      {error.requestId && <span className="ml-2 break-all text-red-600">#{error.requestId}</span>}
    </div>
  )
}

export default function SimulatorPage() {
  const [config, setConfig] = useState<SimConfig | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [reload, setReload] = useState(0)
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [districtId, setDistrictId] = useState('nura')
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null)
  const [calculating, setCalculating] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const revision = useRef(0)
  const analysisAbort = useRef<AbortController | null>(null)

  useEffect(() => {
    let current = true
    getSimConfig().then((data) => {
      if (current) setConfig(data)
    }).catch((err: unknown) => {
      if (current) setLoadError(toError(err))
    })
    return () => { current = false }
  }, [reload])

  useEffect(() => () => analysisAbort.current?.abort(), [])

  function changePlan(next: Decision[]) {
    revision.current += 1
    analysisAbort.current?.abort()
    setAnalyzing(false)
    setCalculating(false)
    setDecisions(next)
    setEvaluation(null)
    setAnalysis('')
    setError(null)
  }

  async function calculate(plan = decisions) {
    const version = revision.current
    setCalculating(true)
    setError(null)
    setEvaluation(null)
    try {
      const next = await evaluateScenario(plan)
      if (version === revision.current) setEvaluation(next)
    } catch (err) {
      if (version === revision.current) setError(toError(err))
    } finally {
      if (version === revision.current) setCalculating(false)
    }
  }

  function loadExample() {
    if (!config) return
    changePlan(config.example)
    void calculate(config.example)
  }

  async function analyze() {
    if (!evaluation?.valid || !evaluation.result) return
    analysisAbort.current?.abort()
    const controller = new AbortController()
    analysisAbort.current = controller
    const version = revision.current
    setAnalysis('')
    setAnalyzing(true)
    setError(null)
    try {
      await analyzeScenario(decisions, (delta) => {
        if (version === revision.current && !controller.signal.aborted) setAnalysis((prev) => prev + delta)
      }, controller.signal)
    } catch (err) {
      if (!controller.signal.aborted && version === revision.current) setError(toError(err))
    } finally {
      if (version === revision.current) setAnalyzing(false)
    }
  }

  if (!config) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 p-6">
        {loadError ? <>
          <ErrorMessage error={loadError} />
          <button className="rounded-xl bg-slate-900 px-4 py-2 text-white" onClick={() => { setLoadError(null); setReload((n) => n + 1) }}>
            Попробовать ещё раз
          </button>
        </> : <p role="status" className="text-slate-500">Загружаем районы и мероприятия…</p>}
      </main>
    )
  }

  const { dataset, baseline } = config
  const cost = decisions.reduce((sum, decision) => sum + (dataset.measures.find((m) => m.id === decision.measure_id)?.cost ?? 0), 0)
  const result = evaluation?.valid ? evaluation.result : null
  const district = dataset.districts.find((d) => d.id === districtId) ?? dataset.districts[0]
  const before = baseline.districts.find((d) => d.id === district.id)!
  const after = result?.districts.find((d) => d.id === district.id)
  const directionName = (id: string) => dataset.directions.find((d) => d.id === id)?.name ?? id
  const districtName = (id: string) => dataset.districts.find((d) => d.id === id)?.name ?? id
  const indicatorName = (code: string) => dataset.indicators.find((i) => i.code === code)?.name ?? code

  return (
    <main className="mx-auto max-w-[1600px] space-y-5 p-4 sm:p-6">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Соберите план для города</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Выберите ровно {dataset.decisions_required} разных мер из {dataset.measures.length}.
            Не больше {dataset.max_per_direction} из одного направления.
            Результат — через {dataset.horizon_quarters} кварталов. Данные районов условные.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={loadExample} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">
            Пример из ТЗ
          </button>
          <button onClick={() => changePlan([])} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm hover:bg-slate-100">
            Сбросить
          </button>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className={`rounded-xl border bg-white p-4 ${cost > dataset.budget ? 'border-red-400 text-red-700' : 'border-slate-200'}`}>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Бюджет</p>
          <p className="mt-1 text-2xl font-bold">{cost} <span className="text-base font-normal text-slate-500">/ {dataset.budget}</span></p>
          <p className="mt-1 text-sm">{cost > dataset.budget ? `Перерасход: ${cost - dataset.budget}` : `Остаток: ${dataset.budget - cost}`}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Выбрано решений</p>
          <p className="mt-1 text-2xl font-bold">{decisions.length} <span className="text-base font-normal text-slate-500">/ {dataset.decisions_required}</span></p>
          <p className="mt-1 text-sm text-slate-500">Каждое мероприятие — один раз</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Базовый Score</p>
          <p className="mt-1 text-2xl font-bold">{baseline.score.toFixed(2)}</p>
          <p className="mt-1 text-sm text-slate-500">Критических показателей: {baseline.n_crit}</p>
        </div>
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
        <section className="min-w-0 space-y-3">
          <h3 className="text-lg font-semibold">1. Мероприятия</h3>
          {dataset.directions.map((direction) => {
            const count = decisions.filter((decision) => dataset.measures.find((m) => m.id === decision.measure_id)?.direction === direction.id).length
            return (
              <div key={direction.id} className="space-y-2">
                <p className={`pt-2 text-sm font-semibold ${count > dataset.max_per_direction ? 'text-red-700' : 'text-slate-500'}`}>
                  {direction.name} · {count}/{dataset.max_per_direction}
                </p>
                {dataset.measures.filter((m) => m.direction === direction.id).map((measure) => {
                  const selected = decisions.find((d) => d.measure_id === measure.id)
                  return (
                    <article key={measure.id} className={`rounded-xl border p-3 ${selected ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-white'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="text-sm font-semibold leading-5">{measure.name}</h4>
                          <p className="mt-1 text-xs leading-5 text-slate-500">
                            {measure.scope === 'city' ? 'Весь город' : 'Один район'} · Лаг: {measure.lag} кв.
                          </p>
                        </div>
                        <span className="whitespace-nowrap text-sm font-bold">{measure.cost} ед.</span>
                      </div>
                      {selected && measure.scope === 'district' && (
                        <label className="mt-3 block text-xs font-medium text-slate-600">
                          Район для меры
                          <select
                            aria-label={`Район: ${measure.name}`}
                            value={selected.district_id ?? ''}
                            onChange={(e) => changePlan(decisions.map((d) => d.measure_id === measure.id ? { ...d, district_id: e.target.value } : d))}
                            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900"
                          >
                            {dataset.districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>
                        </label>
                      )}
                      <button
                        aria-label={`${selected ? 'Убрать' : 'Добавить'}: ${measure.name}`}
                        disabled={!selected && decisions.length >= dataset.decisions_required}
                        onClick={() => changePlan(selected
                          ? decisions.filter((d) => d.measure_id !== measure.id)
                          : [...decisions, { measure_id: measure.id, district_id: measure.scope === 'city' ? null : district.id }])}
                        className={`mt-3 w-full rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-40 ${selected ? 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                      >
                        {selected ? 'Убрать из плана' : 'Добавить'}
                      </button>
                    </article>
                  )
                })}
              </div>
            )
          })}
        </section>

        <section className="min-w-0 space-y-3">
          <h3 className="text-lg font-semibold">2. Районы и показатели</h3>
          <p className="text-sm text-slate-500">Выберите район, чтобы увидеть его исходное состояние и результат плана.</p>
          <div className="grid grid-cols-2 gap-2">
            {dataset.districts.map((d) => {
              const oldDistrict = baseline.districts.find((item) => item.id === d.id)!
              const newDistrict = result?.districts.find((item) => item.id === d.id)
              return (
                <button
                  key={d.id} onClick={() => setDistrictId(d.id)} aria-pressed={district.id === d.id}
                  className={`rounded-xl border p-3 text-left ${district.id === d.id ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white hover:border-slate-400'}`}
                >
                  <span className="block text-sm font-semibold">{d.name}</span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {newDistrict ? `${fmt(oldDistrict.score)} → ${fmt(newDistrict.score)}` : `Базовая оценка: ${fmt(oldDistrict.score)}`}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h4 className="text-lg font-semibold">{district.name}</h4>
            <p className="mt-1 text-sm leading-6 text-slate-500">{district.profile}</p>
            <p className="mt-3 text-xs text-slate-500">
              Шкала 0–100, выше — лучше. Значение ниже {dataset.critical_threshold} считается критическим.
            </p>
            <div className="mt-4 space-y-3">
              {dataset.indicators.map((indicator) => {
                const initial = before.indicators[indicator.code]
                const value = after?.indicators[indicator.code] ?? initial
                return (
                  <div key={indicator.code} className="border-t border-slate-100 pt-3">
                    <div className="flex items-start justify-between gap-3 text-sm">
                      <span className="min-w-0 text-slate-600">{indicator.name}</span>
                      <span className={`whitespace-nowrap font-semibold ${value < dataset.critical_threshold ? 'text-red-700' : 'text-slate-900'}`}>
                        {after ? `${fmt(initial)} → ${fmt(value)}` : fmt(initial)}
                      </span>
                    </div>
                    <div className="mt-1 flex justify-between gap-2 text-xs text-slate-400">
                      <span>{directionName(indicator.direction)}</span>
                      <span>{value < dataset.critical_threshold ? 'Критический показатель' : after && value !== initial ? signed(value - initial) : ''}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        <section className="min-w-0 space-y-3 lg:col-span-2 xl:sticky xl:top-4 xl:col-span-1">
          <h3 className="text-lg font-semibold">3. Результат плана</h3>
          <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
            {decisions.length === 0 ? (
              <p className="text-sm leading-6 text-slate-500">Добавьте мероприятия слева или начните с примера из ТЗ.</p>
            ) : (
              <ol className="space-y-2 text-sm">
                {decisions.map((decision, index) => {
                  const measure = dataset.measures.find((m) => m.id === decision.measure_id)!
                  return <li key={decision.measure_id}>
                    <span className="text-slate-400">{index + 1}. </span>{measure.name}
                    <span className="block pl-4 text-xs text-slate-500">{decision.district_id ? districtName(decision.district_id) : 'Весь город'} · {measure.cost} ед.</span>
                  </li>
                })}
              </ol>
            )}
            <button
              onClick={() => void calculate()} disabled={calculating || decisions.length === 0}
              className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
            >
              {calculating ? 'Считаем…' : decisions.length === dataset.decisions_required ? 'Рассчитать результат' : 'Проверить план'}
            </button>
            {error && <ErrorMessage error={error} />}
            {evaluation && !evaluation.valid && (
              <div role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-semibold">План нужно исправить. Score не рассчитан.</p>
                <ul className="mt-2 list-disc space-y-1 pl-4">{evaluation.violations.map((v, i) => <li key={`${v.code}-${i}`}>{v.message}</li>)}</ul>
              </div>
            )}
            {!result && !evaluation && <p className="text-xs leading-5 text-slate-500">Итоговый Score появится после проверки пяти допустимых решений. Порядок выбора на результат не влияет.</p>}
            {result && <>
              <div className="rounded-xl bg-emerald-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Astana Quality of Life Score</p>
                <p className="mt-2 text-4xl font-bold text-emerald-950">{result.score.toFixed(2)}</p>
                <p className="mt-1 text-sm text-emerald-800" title="Прирост вычислен из значений до округления">
                  {signed(result.score - baseline.score)} к базе · потрачено {result.cost} из {dataset.budget}
                </p>
              </div>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-2"><dt className="text-slate-500">Среднее по городу</dt><dd>{fmt(result.d_avg)}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-slate-500">Самый слабый район</dt><dd>{fmt(result.min_d)}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-slate-500">Критические показатели</dt><dd>{baseline.n_crit} → {result.n_crit}</dd></div>
              </dl>
              <p className="text-xs leading-5 text-slate-400">Score = 70% среднего + 30% оценки слабейшего района − число критических показателей.</p>
              {result.synergies.length > 0 && (
                <div className="rounded-lg bg-indigo-50 p-3 text-sm text-indigo-900">
                  <p className="font-semibold">Сработавшие синергии</p>
                  <ul className="mt-1 space-y-1">{result.synergies.map((s, i) => <li key={i}>{s.pair.join(' + ')} · {districtName(s.district_id)}: {indicatorName(s.indicator)} {signed(s.bonus)}</li>)}</ul>
                </div>
              )}
              <details className="text-sm">
                <summary className="cursor-pointer font-medium">Изменения показателей от мер</summary>
                <ul className="mt-3 space-y-2 text-xs leading-5 text-slate-600">
                  {result.effects.map((effect, i) => (
                    <li key={i}>{effect.measure_id} · {districtName(effect.district_id)}: {indicatorName(effect.indicator)} {signed(effect.value)}</li>
                  ))}
                </ul>
              </details>
              <div className="border-t border-slate-200 pt-4">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-semibold">Объяснение результата</h4>
                  <span className="text-xs text-slate-400">{config.llm_mode === 'mock' ? 'Шаблон' : 'ИИ'}</span>
                </div>
                <button onClick={() => void analyze()} disabled={analyzing} className="mt-3 w-full rounded-xl border border-indigo-200 px-4 py-2.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-40">
                  {analyzing ? 'Готовим объяснение…' : 'Объяснить результат'}
                </button>
                {analyzing && <button className="mt-2 text-xs text-slate-500 underline" onClick={() => { analysisAbort.current?.abort(); setAnalyzing(false) }}>Остановить</button>}
                {analysis && <div aria-live="polite" className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{analysis}</div>}
                {!analysis && !analyzing && <p className="mt-2 text-xs leading-5 text-slate-400">Расчёт уже готов. Разбор объяснит сильные стороны и оставшиеся проблемы.</p>}
              </div>
            </>}
          </div>
        </section>
      </div>
    </main>
  )
}
