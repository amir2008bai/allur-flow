import { Component, type ReactNode } from 'react'

// Если 3D-сцена упадёт (например, нет WebGL), остальная страница продолжит работать.
export default class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { error: boolean }> {
  state = { error: false }
  static getDerivedStateFromError() { return { error: true } }
  componentDidCatch(e: unknown) { console.error('[Allur] view crashed', e) }
  render() { return this.state.error ? this.props.fallback : this.props.children }
}
