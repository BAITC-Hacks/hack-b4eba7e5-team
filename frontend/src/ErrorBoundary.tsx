import { Component, type ReactNode } from 'react'

// Ошибка при отрисовке не должна превращаться в белый экран: показываем сообщение и кнопку перезагрузки.
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error(error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center text-slate-700">
        <p className="text-lg font-medium">Что-то пошло не так</p>
        <button
          onClick={() => location.reload()}
          className="rounded-xl bg-slate-900 px-5 py-2 font-medium text-white"
        >
          Обновить страницу
        </button>
      </div>
    )
  }
}
