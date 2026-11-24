import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { readPanelOpen, rememberPanelOpen } from './panelState'
import type { ViewerSettingsHandle } from './useViewerSettings'
import './settings-panel.css'

type PanelSettings = Pick<ViewerSettingsHandle<unknown>,
  'canConfigure' | 'available' | 'enter' | 'entering' | 'enterError' |
  'dirty' | 'status' | 'error' | 'save' | 'discard' | 'reloadLatest'>

function message({ status, dirty, error }: PanelSettings): string {
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
      return dirty ? 'Unsaved changes' : status === 'saved' ? 'Saved' : 'No unsaved changes'
  }
}

function SlidersIcon() {
  return (
    <svg aria-hidden="true" className="pascal-settings-icon" fill="none" height="16" stroke="currentColor"
      strokeLinecap="round" strokeWidth="1.6" viewBox="0 0 16 16" width="16">
      <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
      <circle cx="10" cy="4.5" r="1.5" />
      <circle cx="6" cy="11.5" r="1.5" />
    </svg>
  )
}

function CollapseIcon() {
  return (
    <svg aria-hidden="true" className="pascal-settings-icon" fill="none" height="16" stroke="currentColor"
      strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 16 16" width="16">
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  )
}

/**
 * Customize: how a project's managers change how this viewer presents the project, and nobody
 * else sees it. Collapsed, a "Customize" tab on the right edge (shown only to someone who may
 * customise: see `useViewerSettings().available`); pressed before Customize mode, it enters it
 * through Pascal. Expanded, a panel with the template's fields (`children`, built from
 * `SettingsSection`, `SettingsRow` and `SettingsOptions`), the save state, Discard and Save.
 *
 * Collapsing keeps the draft (the tab shows a dot while there is one); the open state is
 * remembered for the tab. Theme it with the `--pascal-settings-*` properties (`settings-panel.css`).
 */
export function SettingsPanel({ settings, children, title = 'Customize', description }: {
  settings: PanelSettings
  /** The template's fields. */
  children?: ReactNode
  title?: string
  /** One line under the title; says what is being customised. */
  description?: ReactNode
}) {
  const [open, setOpen] = useState(() => settings.canConfigure && (readPanelOpen() ?? true))
  const panelId = useId()
  const titleId = useId()
  const tab = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)
  // Focus moves only when the visitor opened or closed the panel, never on arrival.
  const moveFocus = useRef(false)

  useEffect(() => {
    if (!moveFocus.current) return
    moveFocus.current = false
    if (open) panel.current?.focus({ preventScroll: true })
    else tab.current?.focus({ preventScroll: true })
  }, [open])

  if (!settings.available) return null
  const expanded = settings.canConfigure && open

  const toggle = (next: boolean) => {
    moveFocus.current = true
    rememberPanelOpen(next)
    setOpen(next)
  }

  if (!expanded) {
    const { dirty, entering, enterError } = settings
    return (
      <div className="pascal-settings-tab-wrap">
        <button
          aria-controls={settings.canConfigure ? panelId : undefined}
          aria-expanded={settings.canConfigure ? false : undefined}
          aria-label={entering ? 'Opening Pascal…' : dirty ? `${title}, unsaved changes` : title}
          className="pascal-settings-tab"
          data-dirty={dirty}
          disabled={entering}
          onClick={() => (settings.canConfigure ? toggle(true) : void settings.enter())}
          ref={tab}
          title={settings.canConfigure ? undefined : 'Customize how visitors see this project in this viewer'}
          type="button"
        >
          <SlidersIcon />
          <span>{entering ? 'Opening…' : title}</span>
          {dirty ? <span aria-hidden="true" className="pascal-settings-dot" /> : null}
        </button>
        {enterError ? <p className="pascal-settings-tab-note" role="status">Customize isn't available here.</p> : null}
      </div>
    )
  }

  const { status, dirty } = settings
  const busy = status === 'saving'
  // Keys pressed in the panel are the panel's: the template's own shortcuts (arrows that turn the
  // view, letters) never fire from here. Escape collapses it.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    event.stopPropagation()
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    toggle(false)
  }

  return (
    <section aria-labelledby={titleId} className="pascal-settings-panel" data-dirty={dirty} data-status={status}
      id={panelId} onKeyDown={onKeyDown} ref={panel} tabIndex={-1}>
      <header className="pascal-settings-header">
        <div className="pascal-settings-heading">
          <h2 className="pascal-settings-title" id={titleId}>{title}</h2>
          <p className="pascal-settings-description">{description ?? 'How visitors first see this project in this viewer.'}</p>
        </div>
        <button aria-controls={panelId} aria-expanded="true" aria-label={`Collapse ${title.toLowerCase()}`}
          className="pascal-settings-icon-button" onClick={() => toggle(false)} type="button">
          <CollapseIcon />
        </button>
      </header>
      <div className="pascal-settings-body">{children}</div>
      <footer className="pascal-settings-footer">
        <p aria-live="polite" className="pascal-settings-message" role="status">{message(settings)}</p>
        <div className="pascal-settings-actions">
          {status === 'conflict' ? (
            <button className="pascal-settings-button" onClick={settings.reloadLatest} type="button">Load the latest</button>
          ) : null}
          <button className="pascal-settings-button" disabled={!dirty || busy} onClick={settings.discard} type="button">
            Discard
          </button>
          <button className="pascal-settings-button pascal-settings-primary" disabled={!dirty || busy || status === 'expired'}
            onClick={() => void settings.save()} type="button">
            Save
          </button>
        </div>
      </footer>
    </section>
  )
}
