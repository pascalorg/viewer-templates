import { type ButtonHTMLAttributes, useEffect, useState } from 'react'
import { Icon, type IconName } from './icons'

// Ported from Pascal's /next demo (MIT): sound and full screen at the top right. There is no title
// or facts block: a host that wants one overlays it on the embedded viewer.

function UtilityButton({ label, icon, ...props }: { label: string; icon: IconName } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const visible = (hovered || focused) && !dismissed
  useEffect(() => {
    if (!visible) return
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') setDismissed(true) }
    addEventListener('keydown', dismiss, true)
    return () => removeEventListener('keydown', dismiss, true)
  }, [visible])
  return (
    <button aria-label={label} className="sc-utility" type="button" {...props}
      onBlur={() => setFocused(false)}
      onFocus={(event) => { if (event.currentTarget.matches(':focus-visible')) { setFocused(true); setDismissed(false) } }}
      onPointerEnter={(event) => { if (event.pointerType !== 'touch') { setHovered(true); setDismissed(false) } }}
      onPointerLeave={() => setHovered(false)}>
      <Icon name={icon} />
      <span aria-hidden="true" className="sc-utility-label" data-visible={visible}>{label}</span>
    </button>
  )
}

export function Utilities({ soundOn, fullscreen, onSound, onFullscreen }: {
  soundOn: boolean
  fullscreen: boolean
  onSound: () => void
  /** Omitted where the browser has no Fullscreen API (iPhone Safari). */
  onFullscreen?: () => void
}) {
  return (
    <div aria-label="Experience controls" className="sc-top-actions" role="group">
      <UtilityButton aria-pressed={soundOn} data-sound-toggle icon={soundOn ? 'sound' : 'muted'}
        label={soundOn ? 'Mute sound' : 'Enable sound'} onClick={onSound} />
      {onFullscreen && <UtilityButton icon="expand" label={fullscreen ? 'Exit full screen' : 'Enter full screen'} onClick={onFullscreen} />}
    </div>
  )
}
