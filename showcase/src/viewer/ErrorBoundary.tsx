import { Component, type ReactNode } from 'react'

/** Shows `fallback` instead of a subtree that threw while rendering. */
export class ErrorBoundary extends Component<{ children?: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error('[viewer] the 3D scene failed to render', error)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
