import type { ReactNode } from 'react'
import type { ViewerSettingsHandle } from './useViewerSettings'
import './settings-bar.css'

type BarSettings = Pick<ViewerSettingsHandle<unknown>, 'canConfigure' | 'dirty' | 'status' | 'error' | 'save' | 'discard' | 'reloadLatest'>

function message({ status, dirty, error }: BarSettings): string {
  switch (status) {
    case 'saving': return 'Saving…'
    case 'conflict': return 'Someone else saved changes.'
    case 'expired': return 'Your session ended. Reopen from Pascal to keep customizing.'
    case 'error':
      if (error?.code === 'too_large') return 'These settings are too large to save.'
      if (error?.code === 'rate_limited') return 'Too many saves. Try again in a minute.'
      if (error?.code === 'network') return "Couldn't reach Pascal. Try again."
      return "Couldn't save. Try again."
    default:
      return dirty ? 'Unsaved changes' : status === 'saved' ? 'Saved' : ''
  }
}

/**
 * The settings bar a manager sees in Customize mode, and nobody else: the template's own controls
 * (`children`), then the save state and Save and Discard. Theme it with the `--pascal-settings-*`
 * properties (see `settings-bar.css`); give your controls `className="pascal-settings-button"`.
 */
export function SettingsBar({ settings, children, label = 'Customize this viewer' }: {
  settings: BarSettings
  children?: ReactNode
  /** The bar's accessible name. */
  label?: string
}) {
  if (!settings.canConfigure) return null
  const { status, dirty } = settings
  const busy = status === 'saving'
  return (
    <section aria-label={label} className="pascal-settings-bar" data-dirty={dirty} data-status={status}>
      {children ? <div className="pascal-settings-controls">{children}</div> : null}
      <p aria-live="polite" className="pascal-settings-message" role="status">{message(settings)}</p>
      {status === 'conflict' ? (
        <button className="pascal-settings-button" onClick={settings.reloadLatest} type="button">Load the latest</button>
      ) : null}
      <div className="pascal-settings-actions">
        <button className="pascal-settings-button" disabled={!dirty || busy} onClick={settings.discard} type="button">
          Discard
        </button>
        <button className="pascal-settings-button pascal-settings-primary" disabled={!dirty || busy || status === 'expired'}
          onClick={() => void settings.save()} type="button">
          Save
        </button>
      </div>
    </section>
  )
}
