import { useEffect, useRef, useState } from 'react'
import AstanaMap from '../components/AstanaMap'
import GuidedTour from '../components/GuidedTour'
import ResizableColumns from '../components/ResizableColumns'
import { districtDisplayName } from '../lib/districts'
import { scrollPanelTo } from '../lib/scrollPanel'
import ScoreGauge from '../components/ScoreGauge'
import DistrictPopup from '../components/DistrictPopup'
import DistrictSelect from '../components/DistrictSelect'
import MeasureDetails from '../components/MeasureDetails'
import {
  ApiError, analyzeScenario, evaluateScenario, getSimConfig,
  type Decision, type Evaluation, type Indicator, type Measure, type SimConfig,
} from '../lib/api'

const fmt = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
const signed = (value: number) => `${value > 0 ? '+' : ''}${fmt(value)}`
const toError = (err: unknown) => err instanceof ApiError ? err : new ApiError('Не удалось выполнить запрос', 0)
const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2'
const motion = 'motion-safe:transition-all motion-safe:duration-200 motion-safe:active:scale-[0.98]'
const enter = 'motion-safe:transition-[opacity,transform] motion-safe:duration-300 motion-safe:starting:translate-y-1 motion-safe:starting:opacity-0'
const panel = 'flex h-[75dvh] min-h-[560px] min-w-0 flex-col overflow-hidden border border-stone-200/80 bg-white md:h-full md:min-h-0'
const panelScroll = 'relative min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600'
const panelLink = `min-h-9 px-2 text-[11px] font-medium text-teal-800 hover:bg-teal-50 ${focus}`

function ErrorMessage({ error }: { error: ApiError }) {
  return (
    <div role="alert" className="rounded-none border border-red-200 bg-red-50 p-3 text-sm text-red-800">
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
  const [openDirection, setOpenDirection] = useState('social')
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null)
  const [calculating, setCalculating] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const [feedback, setFeedback] = useState('')
  const [tourOpen, setTourOpen] = useState(false)
  const revision = useRef(0)
  const calculationRequest = useRef(0)
  const analysisAbort = useRef<AbortController | null>(null)
  function showPanelSection(id: string) {
    const target = document.getElementById(id)
    if (!target) return
    target.focus({ preventScroll: true })
    scrollPanelTo(target, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth')
  }

  useEffect(() => {
    let current = true
    getSimConfig().then((data) => {
      if (current) setConfig(data)
    }).catch((err: unknown) => {
      if (current) setLoadError(toError(err))
    })
    return () => { current = false }
  }, [reload])

  useEffect(() => () => {
    revision.current += 1
    analysisAbort.current?.abort()
  }, [])

  function changePlan(next: Decision[], message = '') {
    revision.current += 1
    analysisAbort.current?.abort()
    setAnalyzing(false)
    setCalculating(false)
    setDecisions(next)
    setEvaluation(null)
    setAnalysis('')
    setError(null)
    setFeedback(message)
  }

  async function calculate(plan = decisions) {
    const version = revision.current
    const request = ++calculationRequest.current
    analysisAbort.current?.abort()
    setAnalyzing(false)
    setAnalysis('')
    setCalculating(true)
    setError(null)
    setEvaluation(null)
    try {
      const next = await evaluateScenario(plan)
      if (version === revision.current && request === calculationRequest.current) setEvaluation(next)
    } catch (err) {
      if (version === revision.current && request === calculationRequest.current) setError(toError(err))
    } finally {
      if (version === revision.current && request === calculationRequest.current) setCalculating(false)
    }
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
      if (version === revision.current && analysisAbort.current === controller) setAnalyzing(false)
    }
  }

  if (!config) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-16 sm:px-6">
        {loadError ? <>
          <ErrorMessage error={loadError} />
          <button className={`rounded-none bg-teal-800 px-4 py-3 text-sm font-medium text-white ${focus} ${motion}`} onClick={() => { setLoadError(null); setReload((n) => n + 1) }}>
            Попробовать ещё раз
          </button>
        </> : <div role="status" className="rounded-none border border-stone-200 bg-white p-6 text-sm text-stone-500">
          <span className="mb-4 block h-2 w-24 rounded-none bg-teal-100 motion-safe:animate-pulse" />
          Загружаем районы и мероприятия…
        </div>}
      </main>
    )
  }

  const { dataset, baseline } = config
  const cost = decisions.reduce((sum, decision) => sum + (dataset.measures.find((m) => m.id === decision.measure_id)?.cost ?? 0), 0)
  const result = evaluation?.valid ? evaluation.result : null
  const district = dataset.districts.find((d) => d.id === districtId) ?? dataset.districts[0]
  const before = baseline.districts.find((d) => d.id === district?.id)
  const after = result?.districts.find((d) => d.id === district?.id)
  const districtName = (id: string) => districtDisplayName(id, dataset.districts.find((d) => d.id === id)?.name ?? id)
  const indicatorName = (code: string) => dataset.indicators.find((i) => i.code === code)?.name ?? code
  const measureName = (id: string) => dataset.measures.find((m) => m.id === id)?.name ?? id
  const directionCount = (id: string) => decisions.filter((decision) => dataset.measures.find((m) => m.id === decision.measure_id)?.direction === id).length

  if (!district || !before || dataset.measures.length === 0) {
    return <main className="mx-auto max-w-2xl p-6"><p className="rounded-none border border-stone-200 bg-white p-6 text-sm text-stone-600">Пока нет данных для симуляции.</p></main>
  }

  function conflictReason(measure: Measure, targetDistrictId: string): string | null {
    const conflict = dataset.incompatibilities.find((rule) => rule.pair.includes(measure.id) && decisions.some((decision) => (
      decision.measure_id !== measure.id && rule.pair.includes(decision.measure_id)
      && (!rule.same_district_only || decision.district_id === targetDistrictId)
    )))
    return conflict ? `${conflict.pair.join(' + ')}: ${conflict.reason}.` : null
  }

  function disabledReason(measure: Measure): string | null {
    if (decisions.length >= dataset.decisions_required) return 'План заполнен. Уберите одну меру, чтобы добавить новую.'
    if (directionCount(measure.direction) >= dataset.max_per_direction) return `Уже выбрано ${dataset.max_per_direction} меры этого направления.`
    if (cost + measure.cost > dataset.budget) return `Не хватает ${fmt(cost + measure.cost - dataset.budget)} ед. бюджета.`
    return conflictReason(measure, district.id)
  }

  function moveMeasure(measure: Measure, targetDistrictId: string) {
    const reason = conflictReason(measure, targetDistrictId)
    if (reason) {
      setFeedback(reason)
      return
    }
    changePlan(decisions.map((item) => item.measure_id === measure.id ? { ...item, district_id: targetDistrictId } : item),
      `Район меры изменён: ${districtName(targetDistrictId)}.`)
  }

  function toggleMeasure(measure: Measure) {
    const selected = decisions.some((decision) => decision.measure_id === measure.id)
    if (!selected && disabledReason(measure)) return
    changePlan(selected
      ? decisions.filter((decision) => decision.measure_id !== measure.id)
      : [...decisions, { measure_id: measure.id, district_id: measure.scope === 'city' ? null : district.id }],
    `${selected ? 'Убрано' : 'Добавлено'}: ${measure.name}.`)
  }

  function indicatorRow(indicator: Indicator) {
    const initial = before!.indicators[indicator.code]
    const value = after?.indicators[indicator.code] ?? initial
    const critical = value < dataset.critical_threshold
    return (
      <div key={indicator.code} className="flex items-center justify-between gap-3 border-t border-stone-100 py-2.5 text-xs">
        <div className="min-w-0">
          <p className="leading-5 text-stone-600" title={indicator.meaning}>{indicator.name}</p>
          <p className="text-[10px] text-stone-400">{indicator.code} · Вес в оценке района: {fmt(indicator.weight * 100)}%</p>
          {critical && <p className="text-[11px] text-amber-700">Ниже порога {dataset.critical_threshold}</p>}
        </div>
        <span className="flex shrink-0 items-center gap-2 tabular-nums">
          {after && <><span className="text-stone-400">{fmt(initial)}</span><span aria-hidden="true" className="text-stone-300">→</span></>}
          <span className={`font-semibold ${critical ? 'text-amber-800' : after && value > initial ? 'text-teal-700' : 'text-stone-800'}`}>{fmt(value)}</span>
          {after && <span className="sr-only">, изменение {signed(value - initial)}</span>}
        </span>
      </div>
    )
  }

  const isComplete = decisions.length === dataset.decisions_required
  const weakestDistricts = result?.districts.filter((item) => item.score === result.min_d) ?? []
  const criticalIndicators = result?.districts.flatMap((item) => (
    dataset.indicators.filter((indicator) => item.indicators[indicator.code] < dataset.critical_threshold)
      .map((indicator) => ({ district: item, indicator, value: item.indicators[indicator.code] }))
  )) ?? []

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-[2200px] flex-1 flex-col px-3 pb-3 pt-4 sm:px-5 2xl:px-6">
      <section className="mb-4 flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-teal-700">Городской симулятор</p>
          <h2 className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">Пять решений для Астаны</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">
            Изучите районы и распределите между ними {dataset.decisions_required} мероприятий на весь город.
            Вы выбираете меры и районы; система учитывает лаги и все положенные бонусы.
          </p>
        </div>
        <div className="flex flex-wrap gap-1 text-xs">
          <button type="button" aria-label="Запустить подсказки" title="Подсказки" onClick={() => setTourOpen(true)} className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-white text-lg font-semibold leading-none text-stone-700 hover:border-teal-700 hover:text-teal-800 ${focus} ${motion}`}>
            ?
          </button>
          <button onClick={() => changePlan([], 'План очищен.')} disabled={decisions.length === 0} className={`min-h-10 rounded-none px-3 text-stone-500 hover:bg-white hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-40 ${focus} ${motion}`}>
            Сбросить
          </button>
        </div>
      </section>
      <p aria-live="polite" role="status" className="sr-only">{feedback}</p>

      <ResizableColumns>
        <section aria-labelledby="district-panel-title" className={`${panel} md:col-start-1 md:row-start-1`}>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-1 border-b border-stone-200 px-3 py-2">
            <h3 id="district-panel-title" className="text-xs font-semibold text-stone-700">Карта и район</h3>
            <nav aria-label="Разделы карты и района" className="flex gap-1">
              <button type="button" onClick={() => showPanelSection('district-map')} aria-controls="district-map" className={panelLink}>Карта</button>
              <button type="button" onClick={() => showPanelSection('district-statistics')} aria-controls="district-statistics" className={panelLink}>Статистика</button>
            </nav>
          </div>
          <div data-scroll-panel="district" role="region" aria-label="Прокрутка карты и статистики района" tabIndex={0} className={`@container ${panelScroll} space-y-4 bg-stone-50`}>
            <div data-tour="map" id="district-map" tabIndex={-1} className="h-full min-h-[640px] focus:outline-none @min-[600px]:min-h-[480px]">
              <AstanaMap districtId={district.id} onDistrictChange={setDistrictId} districts={dataset.districts}
                renderSummary={(onClose) => <DistrictPopup district={after ?? before} dataset={dataset} hasResult={Boolean(after)} onClose={onClose} onFullFormat={() => showPanelSection('district-statistics')} />} />
            </div>
            <div data-tour="district" id="district-statistics" role="region" aria-labelledby="district-statistics-title" tabIndex={-1}
              className="rounded-none border border-stone-200/80 bg-white p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-stone-400">Выбранный район</p>
                  <h3 id="district-statistics-title" className="mt-1 text-lg font-semibold text-stone-900">{districtName(district.id)}</h3>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[10px] text-stone-500">Оценка района</p>
                  <p className="mt-1 flex items-center justify-end gap-2 text-xl font-semibold tabular-nums text-stone-800">
                    {after && <><span className="text-sm font-normal text-stone-400">{fmt(before.score)}</span><span className="text-xs font-normal text-stone-400">→</span></>}
                    <span className={after ? 'text-teal-700' : ''}>{fmt(after?.score ?? before.score)}</span>
                  </p>
                </div>
              </div>
              <p className="mt-2 text-xs leading-5 text-stone-500">{district.profile}</p>
              <p className="mt-1 text-[11px] text-stone-400">Доля населения города: {fmt(district.population_share * 100)}%. Учитывается в среднем балле города.</p>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-1 pb-1 text-[10px] text-stone-400">
                <span>Показатели по направлениям</span>
                <span>{after ? `До → через ${dataset.horizon_quarters} кварталов` : 'От 0 до 100 · выше — лучше'}</span>
              </div>
              <div key={district.id} className={`mt-2 grid gap-x-5 gap-y-3 sm:grid-cols-2 ${enter}`}>
                {dataset.directions.map((direction) => (
                  <div key={direction.id} className="min-w-0">
                    <h4 className="mb-1 text-xs font-semibold text-stone-700">{direction.name}</h4>
                    {dataset.indicators.filter((indicator) => indicator.direction === direction.id).map(indicatorRow)}
                  </div>
                ))}
              </div>
              <p className="mt-1 text-[10px] leading-4 text-stone-400">
                {district.id === 'almaty' ? 'Алматы и Сарайшык объединены на карте; расчёт по данным Алматы из ТЗ.' : 'Данные районов условные, из задания.'}
                {' '}Порог критического значения — ниже {dataset.critical_threshold}.
              </p>
            </div>
          </div>
        </section>

        <section id="decisions-panel" aria-labelledby="decisions-panel-title" className={`${panel} md:col-start-3 md:row-start-1`}>
          <div className="shrink-0 border-b border-stone-200 px-3 py-2">
            <h3 id="decisions-panel-title" className="text-xs font-semibold text-stone-700">Планирование города</h3>
            <nav aria-label="Разделы планирования" className="mt-1 flex flex-wrap gap-1">
              <button type="button" onClick={() => showPanelSection('measures-panel')} aria-controls="measures-panel" className={panelLink}>Мероприятия</button>
              <button type="button" onClick={() => showPanelSection('city-plan')} aria-controls="city-plan" className={panelLink}>План</button>
              <button type="button" onClick={() => showPanelSection('city-score')} aria-controls="city-score" className={panelLink}>Score</button>
            </nav>
          </div>
          <div data-scroll-panel="decisions" role="region" aria-label="Прокрутка мероприятий, плана и Score города" tabIndex={0} className={`${panelScroll} space-y-4 bg-stone-50`}>
            <section id="measures-panel" data-tour="measures" aria-labelledby="catalog-title" tabIndex={-1} className="min-w-0 overflow-hidden border border-stone-200/80 bg-white focus:outline-none">
              <div className="border-b border-stone-100 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 id="catalog-title" className="text-sm font-semibold text-stone-900">Мероприятия</h3>
                  <span className="rounded-none bg-stone-100 px-2 py-1 text-[11px] tabular-nums text-stone-500">{dataset.measures.length} на выбор</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-stone-500">До {dataset.max_per_direction} мер из одного направления.</p>
                <p className="mt-1 hidden text-[10px] leading-4 text-stone-400 md:block">Потяните границу слева, чтобы изменить ширину.</p>
                <p className="mt-3 flex items-center gap-2 rounded-none bg-teal-50 px-2.5 py-2 text-xs text-teal-800">
                  <span aria-hidden="true" className="size-1.5 shrink-0 rounded-none bg-teal-600" />
                  Новые районные меры → {districtName(district.id)}
                </p>
              </div>
              <div className="divide-y divide-stone-100">
                {dataset.directions.map((direction) => {
                  const count = directionCount(direction.id)
                  const isOpen = openDirection === direction.id
                  return (
                    <div key={direction.id}>
                      <button
                        onClick={() => setOpenDirection(isOpen ? '' : direction.id)}
                        aria-expanded={isOpen} aria-controls={`direction-${direction.id}`}
                        className={`flex min-h-14 w-full items-center gap-2 px-4 text-left text-sm hover:bg-stone-50 ${focus} ${motion}`}
                      >
                        <span className={`flex-1 font-medium ${isOpen ? 'text-teal-800' : 'text-stone-700'}`}>{direction.name}</span>
                        <span className={`rounded-none px-1.5 py-0.5 text-[11px] tabular-nums ${count ? 'bg-teal-50 text-teal-700' : 'text-stone-400'}`}>{count}/{dataset.max_per_direction}</span>
                        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={`size-4 text-stone-400 motion-safe:transition-transform motion-safe:duration-200 ${isOpen ? 'rotate-180' : ''}`}><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </button>
                      <div id={`direction-${direction.id}`} inert={!isOpen} className={`grid motion-safe:transition-[grid-template-rows,opacity] motion-safe:duration-300 ${isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                        <div className="overflow-hidden">
                          <div className="space-y-2 px-3 pb-3">
                            {dataset.measures.filter((measure) => measure.direction === direction.id).map((measure) => {
                              const selected = decisions.find((decision) => decision.measure_id === measure.id)
                              const preview = config.measure_previews.find((item) => item.measure_id === measure.id)
                              const reason = selected ? null : disabledReason(measure)
                              return (
                                <article key={measure.id} className={`rounded-none border p-3 motion-safe:transition-colors motion-safe:duration-200 ${selected ? 'border-teal-300 bg-teal-50' : 'border-stone-200/80 bg-stone-50'}`}>
                                  <div className="flex items-start justify-between gap-2">
                                    <h4 className="text-xs font-medium leading-5 text-stone-800">{measure.name}</h4>
                                    <span className="shrink-0 text-sm font-semibold tabular-nums text-stone-800">{measure.cost}<span className="ml-0.5 text-[10px] font-normal text-stone-500">ед.</span></span>
                                  </div>
                                  <p className="mt-1.5 text-[11px] leading-5 text-stone-500">{measure.scope === 'city' ? 'Весь город · одно решение' : 'Один район'}</p>
                                  {preview && <MeasureDetails measure={measure} preview={preview} dataset={dataset} decisions={decisions} />}
                                  <button
                                    aria-label={`${selected ? 'Убрать' : 'Добавить'}: ${measure.name}`}
                                    aria-describedby={reason ? `reason-${measure.id}` : undefined}
                                    aria-pressed={Boolean(selected)} disabled={Boolean(reason)} onClick={() => toggleMeasure(measure)}
                                    className={`mt-2 flex min-h-10 w-full items-center justify-between gap-2 rounded-none px-2.5 text-left text-xs font-medium disabled:cursor-not-allowed ${selected ? 'bg-teal-100 text-teal-800 hover:bg-teal-200' : 'bg-white text-stone-700 hover:bg-teal-50 hover:text-teal-800 disabled:bg-stone-100 disabled:text-stone-400 '} ${focus} ${motion}`}
                                  >
                                    <span>{selected ? `В плане · ${selected.district_id ? districtName(selected.district_id) : 'Весь город'}` : 'Добавить в план'}</span>
                                    <span aria-hidden="true" className="text-lg font-normal leading-none">{selected ? '−' : '+'}</span>
                                  </button>
                                  {reason && <p id={`reason-${measure.id}`} className="mt-2 text-[11px] leading-4 text-stone-500">{reason}</p>}
                                </article>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>

            <section aria-labelledby="plan-title" className="min-w-0 space-y-4">
              <div data-tour="plan" id="city-plan" tabIndex={-1} className="rounded-none border border-stone-200/80 bg-white p-4 focus:outline-none">
                <div className="flex items-center justify-between gap-3">
                  <h3 id="plan-title" className="text-sm font-semibold text-stone-900">Ваш план</h3>
                  <span aria-live="polite" className={`rounded-none px-2.5 py-1 text-[11px] font-medium tabular-nums ${isComplete ? 'bg-teal-100 text-teal-800' : 'bg-stone-100 text-stone-500'}`}>{decisions.length} из {dataset.decisions_required}</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-stone-500">{decisions.length === 0 ? 'Добавляйте меры из каталога. Каждая — один раз.' : 'Район каждой меры можно изменить здесь.'}</p>
                <ol className="mt-4 space-y-2">
                  {decisions.map((decision, index) => {
                    const measure = dataset.measures.find((item) => item.id === decision.measure_id)!
                    const blockedDistricts = measure.scope === 'district'
                      ? dataset.districts.filter((item) => conflictReason(measure, item.id)) : []
                    return (
                      <li key={decision.measure_id} className={`rounded-none border border-stone-200/80 bg-stone-50 p-2.5 ${enter}`}>
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-none bg-white text-[10px] tabular-nums text-stone-400">{index + 1}</span>
                          <p className="flex-1 text-xs font-medium leading-5 text-stone-700">{measure.name}</p>
                          <button onClick={() => toggleMeasure(measure)} aria-label={`Убрать из плана: ${measure.name}`} className={`-mr-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-none text-lg font-normal text-stone-400 hover:bg-white hover:text-red-700 ${focus} ${motion}`}><span aria-hidden="true">×</span></button>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2 pl-7">
                          {measure.scope === 'district' ? (
                            <DistrictSelect label={`Район: ${measure.name}`} value={decision.district_id ?? ''}
                              onChange={(value) => moveMeasure(measure, value)}
                              describedBy={blockedDistricts.length ? `district-conflict-${measure.id}` : undefined}
                              className="min-w-0 max-w-full flex-1"
                              options={dataset.districts.map((item) => ({ value: item.id,
                                label: `${districtName(item.id)}${conflictReason(measure, item.id) ? ' — конфликт мер' : ''}`,
                                disabled: Boolean(conflictReason(measure, item.id)),
                              }))} />
                          ) : <span className="py-2 text-[11px] text-stone-500">Весь город</span>}
                          <span className="shrink-0 text-[11px] tabular-nums text-stone-500">{measure.cost} ед.</span>
                        </div>
                        {blockedDistricts.length > 0 && <p id={`district-conflict-${measure.id}`} className="mt-2 text-[10px] leading-4 text-amber-800">
                          {blockedDistricts.map((item) => `${districtName(item.id)}: ${conflictReason(measure, item.id)}`).join(' ')}
                        </p>}
                      </li>
                    )
                  })}
                  {Array.from({ length: Math.max(0, dataset.decisions_required - decisions.length) }, (_, index) => (
                    <li key={`empty-${index}`} className="flex min-h-11 items-center gap-2 rounded-none border border-dashed border-stone-200 px-2.5 text-[11px] text-stone-400">
                      <span className="flex size-5 items-center justify-center tabular-nums">{decisions.length + index + 1}</span>
                      <span>{index === 0 ? 'Добавьте мероприятие' : 'Свободное решение'}</span>
                    </li>
                  ))}
                </ol>
                <div data-tour="calculate" className="mt-4 border-t border-stone-100 pt-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-xs text-stone-500">Бюджет</p>
                    <p className={`text-xl font-semibold tabular-nums ${cost > dataset.budget ? 'text-red-700' : 'text-stone-900'}`}>{fmt(cost)} <span className="text-xs font-normal text-stone-400">/ {dataset.budget} ед.</span></p>
                  </div>
                  <p className={`mt-1 text-right text-[11px] ${cost > dataset.budget ? 'text-red-700' : 'text-stone-400'}`}>{cost > dataset.budget ? `Перерасход ${fmt(cost - dataset.budget)} ед.` : `Осталось ${fmt(dataset.budget - cost)} ед.`}</p>
                  <button
                    onClick={() => void calculate()} disabled={calculating || !isComplete} aria-describedby="calculate-hint"
                    className={`mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-none bg-teal-800 px-3 text-sm font-semibold text-white hover:bg-teal-900 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500 ${focus} ${motion}`}
                  >
                    {calculating && <span aria-hidden="true" className="size-3 rounded-none border-2 border-white/40 border-t-white motion-safe:animate-spin" />}
                    {calculating ? 'Рассчитываем…' : 'Рассчитать результат'}
                  </button>
                  <p id="calculate-hint" className="mt-2 text-center text-[10px] leading-4 text-stone-400">{isComplete ? `Результат через ${dataset.horizon_quarters} кварталов` : `Для расчёта выберите ровно ${dataset.decisions_required} разных мер.`}</p>
                </div>
              </div>

              {error && <ErrorMessage error={error} />}
              {evaluation && !evaluation.valid && (
                <div role="alert" className={`rounded-none border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900 ${enter}`}>
                  <p className="font-semibold">Исправьте план, чтобы получить Score</p>
                  <ul className="mt-2 list-disc space-y-1 pl-4">{evaluation.violations.map((violation, index) => <li key={`${violation.code}-${index}`}>{violation.message}</li>)}</ul>
                </div>
              )}
              {!result && <div id="city-score" tabIndex={-1} className="flex items-center justify-between gap-3 rounded-none border border-stone-200/60 px-4 py-3 focus:outline-none">
                <div><p className="text-xs text-stone-500">Исходный Score города</p><p className="mt-1 text-[10px] text-stone-400">До вашего плана</p></div>
                <p className="text-xl font-semibold tabular-nums text-stone-600">{fmt(baseline.score)}</p>
              </div>}
              {result && <div id="city-score" tabIndex={-1} className={`overflow-hidden rounded-none border border-teal-200 bg-white focus:outline-none ${enter}`}>
                <div className="bg-stone-50 p-4">
                  <p className="text-center text-[10px] font-semibold uppercase tracking-wider text-stone-600">Итоговый Score города</p>
                  <ScoreGauge score={result.score} />
                  <p role="status" className="sr-only">План рассчитан. Score {fmt(result.score)} из 100.</p>
                  <div className="mt-2 flex justify-center">
                    <p className={`rounded-none px-2.5 py-1 text-xs font-medium tabular-nums ${result.score >= baseline.score ? 'bg-teal-50 text-teal-800' : 'bg-red-50 text-red-800'}`} title="Прирост вычислен из значений до округления">{signed(result.score - baseline.score)} к базе</p>
                  </div>
                  <p className="mt-2 text-center text-[11px] text-stone-500">Было {fmt(baseline.score)} · Через {dataset.horizon_quarters} кварталов</p>
                </div>
                <div className="space-y-4 p-4">
                  <dl className="space-y-2.5 text-xs">
                    <div className="flex justify-between gap-2"><dt className="text-stone-500">Среднее по городу</dt><dd className="font-medium tabular-nums text-stone-800">{fmt(result.d_avg)}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-stone-500">Слабейший район</dt><dd className="text-right font-medium tabular-nums text-stone-800">{weakestDistricts.map((item) => districtName(item.id)).join(', ')} · {fmt(result.min_d)}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-stone-500">Критические показатели</dt><dd className="font-medium tabular-nums text-stone-800">{baseline.n_crit} → {result.n_crit}</dd></div>
                  </dl>
                  <p className="text-[11px] leading-5 text-stone-500">Результат ваших пяти решений. Чтобы повысить Score, измените план и рассчитайте его снова.</p>
                  <div className="text-[11px] leading-5">
                    <h4 className="font-semibold text-stone-700">Бонусы применены автоматически</h4>
                    {result.synergies.length > 0 ? (
                      <ul className="mt-2 space-y-2 text-teal-800">{result.synergies.map((synergy, index) => <li key={index}>{synergy.pair.join(' + ')} · {districtName(synergy.district_id)}: {indicatorName(synergy.indicator)} {signed(synergy.bonus)}</li>)}</ul>
                    ) : <p className="mt-1 text-stone-500">В этом наборе нет пар с дополнительным бонусом.</p>}
                  </div>
                  <details className="text-xs">
                    <summary className={`cursor-pointer rounded-none py-1 font-medium text-stone-500 hover:text-teal-700 ${focus}`}>Из чего складывается результат</summary>
                    <p className="mt-3 text-[11px] leading-5 text-stone-500">Score = {fmt(dataset.score_formula.avg_weight * 100)}% среднего + {fmt(dataset.score_formula.min_weight * 100)}% оценки слабейшего района − {fmt(dataset.score_formula.critical_penalty)} за каждый показатель ниже {dataset.critical_threshold}.</p>
                    <p className="mt-2 text-[11px] leading-5 text-stone-500">Эффект меры = полный эффект × ({dataset.horizon_quarters} − лаг) / {dataset.horizon_quarters}. Бонусы добавляются целиком, затем показатели ограничиваются от 0 до 100.</p>
                    <table className="mt-3 w-full text-left text-[11px] tabular-nums">
                      <caption className="mb-2 text-left font-medium text-stone-700">Оценки районов</caption>
                      <thead><tr className="text-stone-500"><th scope="col" className="py-1">Район</th><th scope="col">Было</th><th scope="col">Стало</th></tr></thead>
                      <tbody>{result.districts.map((item) => <tr key={item.id} className="border-t border-stone-100 text-stone-600"><th scope="row" className="py-1 font-normal">{districtName(item.id)}</th><td>{fmt(baseline.districts.find((initial) => initial.id === item.id)!.score)}</td><td>{fmt(item.score)}</td></tr>)}</tbody>
                    </table>
                    {criticalIndicators.length > 0 && <div className="mt-3 text-[11px] leading-5 text-amber-800">
                      <p className="font-semibold">За что начислен штраф</p>
                      <ul>{criticalIndicators.map((item) => <li key={`${item.district.id}-${item.indicator.code}`}>{districtName(item.district.id)} · {item.indicator.name}: {fmt(item.value)}</li>)}</ul>
                    </div>}
                    <p className="mt-3 font-medium text-stone-700">Прямые изменения показателей от мер</p>
                    <ul className="mt-3 space-y-3 text-[11px] leading-5 text-stone-500">
                      {result.effects.map((effect, index) => <li key={index}><span className="font-medium text-stone-700">{measureName(effect.measure_id)}</span><br />{districtName(effect.district_id)} · {indicatorName(effect.indicator)} {signed(effect.value)}</li>)}
                    </ul>
                  </details>
                  <div className="border-t border-stone-100 pt-4">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-xs font-semibold text-stone-800">Разбор плана</h4>
                      <span className="rounded-none bg-stone-100 px-1.5 py-1 text-[10px] text-stone-500">{config.llm_mode === 'mock' ? 'Шаблон' : 'ИИ'}</span>
                    </div>
                    <button onClick={() => void analyze()} disabled={analyzing} className={`mt-3 min-h-11 w-full rounded-none border border-teal-200 px-3 py-2 text-xs font-semibold text-teal-800 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50 ${focus} ${motion}`}>
                      {analyzing ? 'Готовим объяснение…' : analysis ? 'Объяснить ещё раз' : 'Объяснить результат'}
                    </button>
                    {analyzing && <button className={`mt-1 min-h-9 rounded-none px-2 text-xs text-stone-500 underline underline-offset-4 ${focus}`} onClick={() => { analysisAbort.current?.abort(); setAnalyzing(false) }}>Остановить</button>}
                    {analysis && <div aria-live="polite" className={`mt-3 whitespace-pre-wrap text-xs leading-6 text-stone-600 ${enter}`}>{analysis}</div>}
                    {!analysis && !analyzing && <p className="mt-2 text-[10px] leading-4 text-stone-400">Сильные стороны плана и проблемы, которые ещё остались.</p>}
                  </div>
                </div>
              </div>}
            </section>
          </div>
        </section>
      </ResizableColumns>
      {tourOpen && <GuidedTour onClose={() => setTourOpen(false)} />}
    </main>
  )
}
