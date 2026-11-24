import { SettingsOptions, SettingsRow, SettingsSection, type ViewerSettingsHandle } from '../pascal-react'
import type { DrawingSettings } from '../settings'
import { type DrawingView, navigation, type Projection } from '../viewer/navigation'

/** What the drawing opens on with nothing saved: the axonometric view from the first corner, fitted. */
const DEFAULT_VIEW: DrawingView = { projection: 'axonometric', turns: 0, zoom: 1 }
const PROJECTIONS = [{ value: 'axonometric', label: 'Axonometric' }, { value: 'plan', label: 'Plan' }] as const
const TURNS = [0, 1, 2, 3] as const
const zoomText = (zoom: number) => (Math.abs(zoom - 1) < 0.005 ? 'Fits the building' : `${zoom.toFixed(2).replace(/\.?0+$/, '')}× the fit`)

/**
 * Minimal's fields in the Customize panel: the opening view's projection, turn and zoom, each saying
 * what is set. Choosing one also turns the drawing to it; "Use current view" takes all of them
 * (and the centre) from the screen.
 */
export function OpeningSettings({ settings }: { settings: ViewerSettingsHandle<DrawingSettings> }) {
  const opening = settings.value.opening
  const view = opening ?? DEFAULT_VIEW
  const set = (patch: Partial<DrawingView>) =>
    settings.set((current) => ({ ...current, opening: { ...(current.opening ?? DEFAULT_VIEW), ...patch } }))
  const custom = (text: string) => (opening ? text : `Default (${text.toLowerCase()})`)

  return (
    <SettingsSection description="Where the drawing opens. Visitors move freely from there." title="Opening view">
      <div className="pascal-settings-row-controls">
        <button className="pascal-settings-button pascal-settings-primary" type="button" onClick={() => {
          const current = navigation.currentView()
          if (current) settings.set((previous) => ({ ...previous, opening: current }))
        }}>
          Use current view
        </button>
        <button aria-label="Clear opening view" className="pascal-settings-button" disabled={!opening} type="button"
          onClick={() => settings.set(({ opening: _, ...rest }) => rest)}>
          Clear
        </button>
      </div>
      <p className="pascal-settings-hint">Sets the projection, turn, zoom and centre from the screen.</p>

      <SettingsRow label="Projection" value={custom(view.projection === 'plan' ? 'Plan' : 'Axonometric')}>
        <SettingsOptions<Projection> label="Projection" options={PROJECTIONS} value={view.projection}
          onChange={(projection) => {
            set({ projection })
            navigation.setProjection(projection)
          }} />
      </SettingsRow>

      <SettingsRow label="Turn" value={custom(view.turns === 0 ? 'First corner' : `${view.turns * 90}° round`)}>
        <SettingsOptions<string> label="Turn" options={TURNS.map((turns) => ({ value: String(turns), label: `${turns * 90}°` }))}
          value={String(view.turns)}
          onChange={(value) => {
            const turns = Number(value) as DrawingView['turns']
            set({ turns })
            // Turn the drawing there, a quarter at a time, the short way.
            const delta = (turns - (navigation.currentView()?.turns ?? 0) + 4) % 4
            if (delta === 3) navigation.rotate(-1)
            else for (let step = 0; step < delta; step++) navigation.rotate(1)
          }} />
      </SettingsRow>

      <SettingsRow label="Zoom" value={custom(zoomText(view.zoom))}>
        <button aria-label="Fit the building" className="pascal-settings-button" disabled={!opening || (view.zoom === 1 && !view.target)}
          type="button" onClick={() => {
            set({ zoom: 1, target: undefined })
            navigation.fit()
          }}>
          Fit
        </button>
      </SettingsRow>
    </SettingsSection>
  )
}
