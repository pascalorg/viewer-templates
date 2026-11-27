import { Button } from '@pascal-app/viewer/ui'
import { TriangleAlert } from 'lucide-react'
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

/** Crash fallback matching the full-page status screens and adapting to system light/dark. */
export function SceneCrashFallback({ projectName }: { projectName: string | null }) {
  return (
    <div className="studio-backdrop absolute inset-0 z-30 flex items-center justify-center p-4 text-foreground sm:p-6">
      <div className="corner-smooth w-full max-w-md rounded-2xl border border-border/80 bg-card/95 p-7 text-card-foreground shadow-elevation-5 backdrop-blur-xl sm:p-8">
        <div
          aria-hidden
          className="mb-5 flex size-11 items-center justify-center rounded-xl border border-destructive/20 bg-destructive/10 text-destructive"
        >
          <TriangleAlert className="size-5" />
        </div>
        <div className="space-y-3">
          <h2 className="font-semibold text-2xl text-card-foreground leading-tight tracking-[-0.02em]">
            The 3D scene failed to render
          </h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {projectName ? `"${projectName}" ` : ''}
            hit a rendering error.
          </p>
          <div className="pt-2">
            <Button
              className="studio-interactive h-10 rounded-full px-5 font-medium"
              onClick={() => window.location.reload()}
              type="button"
            >
              Reload scene
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
