import { useEffect, useRef, useState } from 'react'
import { ApiError, optimizeScenario, type Decision, type Optimum, type Scenario, type SimConfig } from '../lib/api'

const fmt = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
const button = 'min-h-11 w-full border border-teal-200 px-3 py-2 text-xs font-semibold text-teal-800 hover:bg-teal-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600'

export default function PlanAdvisor({ config, decisions, current, onApply }: {
  config: SimConfig; decisions: Decision[]; current: Scenario | null; onApply: (plan: Decision[]) => void
}) {
  const [proposal, setProposal] = useState<Optimum | null>(null)
  const [text, setText] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [complete, setComplete] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  async function search() {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setBusy(true)
    setComplete(false)
    setProposal(null)
    setText('')
    setError(null)
    setStatus('Подбираем лучший план…')
    try {
      await optimizeScenario(current ? decisions : [],
        (delta) => { if (!controller.signal.aborted) setText((prev) => prev + delta) },
        (value) => { if (!controller.signal.aborted) setStatus(value) },
        (value) => { if (!controller.signal.aborted) setProposal(value) }, controller.signal)
      if (!controller.signal.aborted) setComplete(true)
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof ApiError ? err : new ApiError('Не удалось подобрать план', 0))
    } finally {
      if (abort.current === controller) { setBusy(false); setStatus('') }
    }
  }

  const before = current ?? config.baseline
  return (
    <section aria-labelledby="advisor-title" className="border border-stone-200 bg-white p-4">
      <h3 id="advisor-title" className="text-sm font-semibold text-stone-900">Советник</h3>
      <p className="mt-2 text-xs leading-5 text-stone-500">Подберём максимум Score по правилам задания и сравним с {current ? 'вашим планом' : 'исходным состоянием города'}. Применение — по вашему выбору.</p>
      <button onClick={() => void search()} disabled={busy} className={`mt-3 ${button}`}>
        {busy ? 'Ищем и сравниваем…' : 'Подобрать лучший план'}
      </button>
      {busy && <>
        <p role="status" className="mt-2 text-xs text-stone-500">{status}</p>
        <button className="min-h-9 text-xs text-stone-600 underline" onClick={() => { abort.current?.abort(); setBusy(false); setStatus('') }}>Остановить</button>
      </>}
      {proposal && <div className="mt-4 space-y-3 text-xs text-stone-700">
        <p className="font-semibold text-teal-800">{proposal.exact ? 'Точный максимум Score' : 'Найденный план'} · проверено {fmt(proposal.evaluated)} сценариев</p>
        <table className="w-full text-left tabular-nums">
          <caption className="sr-only">Сравнение планов</caption>
          <thead><tr><th>Показатель</th><th>{current ? 'Ваш план' : 'База'}</th><th>Предложение</th></tr></thead>
          <tbody>
            <tr><th className="py-2 font-normal">Score</th><td>{fmt(before.score)}</td><td>{fmt(proposal.result.score)}</td></tr>
            <tr><th className="py-2 font-normal">Стоимость</th><td>{before.cost}</td><td>{proposal.result.cost}</td></tr>
            <tr><th className="py-2 font-normal">Критические показатели</th><td>{before.n_crit}</td><td>{proposal.result.n_crit}</td></tr>
          </tbody>
        </table>
        <ul className="space-y-2">{proposal.decisions.map((item) => <li key={item.measure_id}>
          {config.dataset.measures.find((measure) => measure.id === item.measure_id)?.name} · {item.district_id ? config.dataset.districts.find((district) => district.id === item.district_id)?.name : 'Весь город'}
        </li>)}</ul>
        <button onClick={() => onApply(proposal.decisions)} className={button}>Применить предложенный план</button>
      </div>}
      {error && <p role="alert" className="mt-3 text-xs text-red-700">{error.message} {error.requestId && `#${error.requestId}`}</p>}
      {text && <div className="mt-3 whitespace-pre-wrap text-xs leading-6 text-stone-600">{text}</div>}
      {!busy && !complete && text && <p role="status" className="mt-2 text-xs text-amber-800">Объяснение не завершено. Расчёт найденного плана показан выше.</p>}
    </section>
  )
}
