import { CircleHelp, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

/** The guide's recordings, served from `public/help/`. */
const clip = (name: string) => `${import.meta.env.BASE_URL}help/${name}`

const STEPS = [
  {
    title: 'Name rooms the same in both',
    body: "Give each Home Assistant area the same name as its room in Pascal, such as Main bedroom in both. The viewer then puts that area's devices in the right room by itself, ready to link.",
    image: clip('link-names.gif'),
    alt: 'The Main bedroom area in Home Assistant, then the same Main bedroom with its devices in the viewer',
  },
  {
    title: 'Devices that belong to a room',
    body: 'Sensors such as humidity, temperature or motion read the whole room. Pick the room, then choose the device under "Add to" in the room card. Devices Home Assistant already puts in that room are tinted until you link them.',
    image: clip('link-room.gif'),
    alt: 'Picking the main bedroom, then adding Main bedroom humidity to it from the room card',
  },
  {
    title: 'Devices you can see on the plan',
    body: 'An air conditioner, a lamp or a TV has its own model. Pick the room, click the model itself, then choose the device in the card that opens. The model comes alive with the device.',
    image: clip('link-device.gif'),
    alt: 'Picking the living room, clicking its air conditioner, then linking Ecobee to it',
  },
] as const

/**
 * A round help button, and over it a short guide to linking Home Assistant's devices to the plan:
 * areas named as the rooms are matched by themselves, a device that reads a whole room is added to
 * the room, one with a model of its own is linked by clicking that model. Each is shown with a recording.
 */
export function HelpGuide({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  // a click elsewhere or Escape closes the guide
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    addEventListener('pointerdown', onDown, true)
    addEventListener('keydown', onKey, true)
    return () => {
      removeEventListener('pointerdown', onDown, true)
      removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div className={`pointer-events-auto relative ${className}`} ref={root}>
      {open && (
        <div
          aria-label="How to link devices"
          className="ui-scroll absolute right-0 bottom-12 max-h-[calc(100vh-7rem)] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto rounded-3xl border border-border/60 bg-background/95 p-4 text-foreground shadow-elevation-4 backdrop-blur-xl"
          role="dialog"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="font-semibold text-sm">How to link devices</p>
            <button
              aria-label="Close"
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
              onClick={() => setOpen(false)}
              type="button"
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </div>
          <ol className="grid gap-4">
            {STEPS.map((step, i) => (
              <li className="grid gap-2" key={step.title}>
                <p className="font-medium text-sm">
                  <span className="mr-1.5 text-muted-foreground">{i + 1}.</span>
                  {step.title}
                </p>
                <p className="text-muted-foreground text-xs leading-relaxed">{step.body}</p>
                <img alt={step.alt} className="w-full rounded-2xl border border-border/60" decoding="async" loading="lazy" src={step.image} />
              </li>
            ))}
          </ol>
        </div>
      )}
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="How to link devices"
        className="corner-smooth flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-background/95 text-foreground shadow-elevation-4 backdrop-blur-xl transition-colors hover:bg-background focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
        onClick={() => setOpen((o) => !o)}
        type="button"
      >
        <CircleHelp aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  )
}
