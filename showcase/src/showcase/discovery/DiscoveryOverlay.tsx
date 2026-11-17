import { emitter } from '@pascal-app/core'
import type { CalloutAction, CalloutText } from '@pascal-app/viewer'
import type { ReactNode } from 'react'
import { cue } from '../sounds'
import { calloutDom, labelDom, useDiscovery } from './state'

/**
 * The discovery label and the pinned item callout: /next's DOM and CSS (`showcase.css`, `sc-zone`),
 * positioned each frame by `DiscoveryScene`. `ink="light"` is the dark-on-pale variant for day.
 */
export function DiscoveryOverlay({ ink }: { ink: 'default' | 'light' }) {
  const callout = useDiscovery((state) => state.callout)
  return (
    <>
      <div aria-hidden="true" className="sc-zone" data-ink={ink} data-visible="false" ref={(element) => { labelDom.root = element }}>
        <span className="sc-zone-pin" />
        <span className="sc-zone-leader" />
        <div className="sc-zone-copy">
          <strong ref={(element) => { labelDom.title = element }} />
          <span ref={(element) => { labelDom.subtitle = element }} />
        </div>
      </div>
      <div className="sc-zone sc-item" data-ink={ink} data-visible="false" ref={(element) => { calloutDom.root = element }}
        role="status" aria-live="polite" hidden={!callout}>
        <span aria-hidden="true" className="sc-zone-pin" />
        <span aria-hidden="true" className="sc-zone-leader" />
        {callout && (
          <div className="sc-zone-copy" ref={(element) => { calloutDom.copy = element }}
            onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
            <strong>{callout.title}</strong>
            {callout.subtitle ? <span>{text(callout.subtitle)}</span> : null}
            <div className="sc-zone-actions">
              {callout.actions.map((action) => action.kind === 'toggle'
                ? <ToggleAction action={action} key={action.key} />
                : <RangeAction action={action} key={action.key} />)}
              <button aria-label="Dismiss" className="sc-zone-dismiss" onClick={() => { cue('dismiss'); callout.onDismiss() }} title="Dismiss" type="button">
                <Glyph icon="close" on={false} />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

/** Scene text as written, or the package's English copy for a message (no catalogs here). */
function text(value: CalloutText): string {
  if (typeof value === 'string') return value
  const descriptor = value as { message?: string; id: string; values?: Record<string, unknown> }
  const message = descriptor.message ?? descriptor.id
  return message.replace(/\{(\w+)\}/g, (_, key: string) => String(descriptor.values?.[key] ?? ''))
}

type Toggle = Extract<CalloutAction, { kind: 'toggle' }>
const opens = (icon: Toggle['icon']) => icon === 'door' || icon === 'window' || icon === 'shutters'

function ToggleAction({ action }: { action: Toggle }) {
  const state = opens(action.icon) ? (action.on ? 'Open' : 'Closed') : action.on ? 'On' : 'Off'
  const name = action.text ? text(action.text) : action.name
  const verb = action.icon === 'shutters'
    ? `${action.on ? 'Close' : 'Open'} the shutters of ${name}`
    : `${opens(action.icon) ? (action.on ? 'Close' : 'Open') : action.on ? 'Turn off' : 'Turn on'} ${name}`
  return (
    <button aria-label={verb} aria-pressed={action.on} className="sc-zone-action" data-control={action.text ? 'named' : opens(action.icon) ? 'opening' : 'toggle'}
      onClick={() => {
        // The package's sounds, as its own callout plays them: on at the press, a closing door
        // swings and then latches when its run lands.
        if (!action.on) emitter.emit('interaction:sound', action.sound.on)
        const settled = action.toggle()
        if (!action.on) return
        if (!settled || action.sound.off === 'garage') emitter.emit('interaction:sound', action.sound.off)
        else {
          if (action.sound.swing) emitter.emit('interaction:sound', action.sound.swing)
          void settled.then(() => emitter.emit('interaction:sound', action.sound.off))
        }
      }} title={verb} type="button">
      <Glyph icon={action.icon} on={action.on} />
      <span>{action.text ? text(action.text) : state}</span>
    </button>
  )
}

function RangeAction({ action }: { action: Extract<CalloutAction, { kind: 'range' }> }) {
  return (
    <label className="sc-zone-action sc-zone-range">
      <span>{action.label} {action.value}{action.unit ?? ''}</span>
      <input aria-label={action.label} max={action.max} min={action.min} onChange={(event) => action.onChange(Number(event.target.value))}
        step={action.step} type="range" value={action.value} />
    </label>
  )
}

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden="true" fill="none" focusable="false" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} viewBox="0 0 24 24">
      {children}
    </svg>
  )
}

/** The viewer callout's glyphs (`@pascal-app/viewer`'s `SelectionCallout`). */
function Glyph({ icon, on }: { icon: Toggle['icon'] | 'close'; on: boolean }) {
  switch (icon) {
    case 'light':
      return <Svg><path d="M9 18h6m-5 3h4M8 13a6 6 0 1 1 8 0c-1.2 1-1 2-1 2H9s.2-1-1-2Z" />{on ? <path d="M12 1v1M3 4l1 1m16-1-1 1M1 10h1m20 0h-1" /> : <path d="m3 3 18 18" opacity=".6" />}</Svg>
    case 'fan':
      return <Svg><circle cx="12" cy="12" r="2" /><path d="M10.5 10.5C6 5 10 1 13 3c2 2 0 5-1 7M14 11c6-2 9 3 6 5-2 2-5-1-7-3M11.5 14c-1 6-7 6-8 3-1-3 4-4 7-4" />{on ? null : <path d="m3 3 18 18" opacity=".6" />}</Svg>
    case 'window':
      return <Svg><path d={on ? 'M3 3h18v18H3ZM3 12h10M13 3v18m0-14 6-2v14l-6-2' : 'M3 3h18v18H3ZM12 3v18M3 12h18'} /></Svg>
    case 'door':
      return <Svg><path d={on ? 'M3 21h18M5 21V3h14v18M5 3l9 3v15M11 12v2' : 'M3 21h18M5 21V3h14v18M15 12h1'} /></Svg>
    case 'shutters':
      return on
        ? <Svg><rect height="16" rx="1" width="8" x="8" y="4" /><path d="M8 4 3 6v12l5 2M16 4l5 2v12l-5 2" /></Svg>
        : <Svg><rect height="18" rx="1" width="16" x="4" y="3" /><path d="M12 3v18M7 8h2M7 12h2M7 16h2M15 8h2M15 12h2M15 16h2" /></Svg>
    case 'close':
      return <Svg><path d="m6 6 12 12M6 18 18 6" /></Svg>
    default:
      return <Svg><path d="M12 2v9m-5-7a9 9 0 1 0 10 0" /></Svg>
  }
}
