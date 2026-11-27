import { type SurfaceRole, usePascalI18n, useScene } from '@pascal-app/core'
import {
  CLAY_PALETTE,
  isTypingTarget,
  presetInstant,
  type RenderQuality,
  type RenderQualityChoice,
  requestDeviceLocation,
  resolveLocation,
  SCENE_THEMES,
  type SkyPhase,
  skyPhase,
  solarClockInstant,
  solarClockMinutes,
  solarPosition,
  sunEvents,
  type TimeOfDay,
  useViewer,
  WEATHER_COVER,
  type Weather,
} from '@pascal-app/viewer'
import { sceneThemeName, Switch, Tooltip, TooltipContent, TooltipTrigger, useFollowPascal, useIsMobile } from '@pascal-app/viewer/ui'
import {
  Camera,
  Check,
  Cloud,
  CloudSun,
  Cloudy,
  Contrast,
  Eye,
  Gauge,
  Layers,
  LocateFixed,
  Moon,
  Palette,
  PenLine,
  RotateCcw,
  SlidersHorizontal,
  Square,
  Sun,
  Sunrise,
  Sunset,
  Video,
  X,
} from 'lucide-react'
import { Monitor as MonitorIcon } from 'lucide-react'
import { useTheme } from './theme'
import { type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'

export type InspectorTabId = 'scene' | 'look' | 'light'

const TABS: readonly { id: InspectorTabId; label: string }[] = [
  { id: 'scene', label: 'Scene' },
  { id: 'look', label: 'Look' },
  { id: 'light', label: 'Light' },
]

// ---- Shared light-panel primitives --------------------------------------------------------------

function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="font-semibold text-[11px] text-[var(--glass-muted)] uppercase tracking-[0.12em]">{children}</span>
      {right}
    </div>
  )
}

function ControlCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-raised-soft)] p-3">
      {children}
    </div>
  )
}

function SwitchRow({ icon: Icon, label, detail, checked, onCheckedChange, disabled }: {
  icon: typeof Eye
  label: string
  detail?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--glass-bg-subtle)] text-[var(--glass-ink)]/80">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-[13px] text-[var(--glass-ink)] leading-snug">{label}</div>
        {detail && <div className="text-[var(--glass-muted)] text-xs leading-snug">{detail}</div>}
      </div>
      <Switch
        aria-label={label}
        checked={checked}
        className="data-[state=checked]:bg-[var(--glass-accent)] data-[state=unchecked]:bg-[rgb(15_23_42/0.16)]"
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  )
}

function SegmentedRow<T extends string>({ label, options, value, onChange }: {
  label: string
  options: readonly { id: T; label: string; icon?: typeof Layers }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>{label}</SectionLabel>
      <div aria-label={label} className="grid rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg-subtle)] p-0.5" role="radiogroup" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((option) => {
          const Icon = option.icon
          const active = value === option.id
          return (
            <button
              aria-checked={active}
              className={`studio-interactive flex h-8 items-center justify-center gap-1.5 rounded-full px-2 text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] ${
                active
                  ? 'bg-[var(--glass-raised)] font-semibold text-[var(--glass-accent)] shadow-xs'
                  : 'font-medium text-[var(--glass-muted)] hover:text-[var(--glass-ink)]'
              }`}
              key={option.id}
              onClick={() => onChange(option.id)}
              role="radio"
              type="button"
            >
              {Icon && <Icon aria-hidden className="size-3.5 shrink-0" />}
              <span className="truncate">{option.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---- Tab 2: Scene -------------------------------------------------------------------------------

function SceneTab({ glbActive, glbHasScans, glbHasGuides }: {
  glbActive: boolean
  glbHasScans: boolean
  glbHasGuides: boolean
}) {
  const i18n = usePascalI18n()
  const showScans = useViewer((s) => s.showScans)
  const showGuides = useViewer((s) => s.showGuides)
  const followOn = useFollowPascal((s) => s.on)
  const setFollowOn = useFollowPascal((s) => s.setOn)

  const canShowScans = !glbActive || glbHasScans
  const canShowGuides = !glbActive || glbHasGuides

  return (
    <div className="hud-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      {(canShowScans || canShowGuides) && (
        <ControlCard>
          <SectionLabel>{i18n._({ id: 'viewer.visibility.title', message: 'Visibility' })}</SectionLabel>
          {canShowScans && (
            <SwitchRow
              checked={showScans}
              icon={Eye}
              label={i18n._({ id: 'viewer.visibility.scans', message: 'Scans' })}
              onCheckedChange={(checked) => useViewer.getState().setShowScans(checked)}
            />
          )}
          {canShowGuides && (
            <SwitchRow
              checked={showGuides}
              icon={Layers}
              label={i18n._({ id: 'viewer.visibility.guides', message: 'Guides' })}
              onCheckedChange={(checked) => useViewer.getState().setShowGuides(checked)}
            />
          )}
        </ControlCard>
      )}

      <ControlCard>
        <SectionLabel>Camera assist</SectionLabel>
        <SwitchRow
          checked={followOn}
          detail="Follow what Pascal builds automatically."
          icon={Video}
          label="Follow Pascal"
          onCheckedChange={setFollowOn}
        />
      </ControlCard>
    </div>
  )
}

// ---- Tab 3: Look --------------------------------------------------------------------------------

const SWATCH_ROLES: readonly SurfaceRole[] = ['wall', 'roof', 'floor', 'glazing']

function LookTab() {
  const i18n = usePascalI18n()
  const themeChoice = useTheme((s) => s.choice)
  const shadows = useViewer((s) => s.shadows)
  const cameraMode = useViewer((s) => s.cameraMode)
  const textures = useViewer((s) => s.textures)
  const quality = useViewer((s) => s.renderQuality)
  const qualityChoice = useViewer((s) => s.renderQualityChoice)
  const sceneTheme = useViewer((s) => s.sceneTheme)
  const edges = useViewer((s) => s.edges)

  const tiers: { id: RenderQuality; name: string; detail: string }[] = [
    {
      id: 'low',
      name: i18n._({ id: 'viewer.daylight.quality.low', message: 'Low' }),
      detail: i18n._({ id: 'viewer.daylight.quality.lowDetail', message: 'Fastest — no ambient occlusion or bloom' }),
    },
    {
      id: 'medium',
      name: i18n._({ id: 'viewer.daylight.quality.medium', message: 'Medium' }),
      detail: i18n._({ id: 'viewer.daylight.quality.mediumDetail', message: 'Half-resolution ambient occlusion' }),
    },
    {
      id: 'high',
      name: i18n._({ id: 'viewer.daylight.quality.high', message: 'High' }),
      detail: i18n._({ id: 'viewer.daylight.quality.highDetail', message: 'Lighting-aware ambient occlusion and bloom' }),
    },
  ]
  const activeTier = tiers.find((t) => t.id === quality) ?? tiers[2]!
  const autoName = i18n._({ id: 'viewer.daylight.quality.auto', message: 'Auto' })
  const qualityOptions: { id: RenderQualityChoice; name: string; detail: string }[] = [
    {
      id: 'auto',
      name: autoName,
      detail: i18n._({
        id: 'viewer.daylight.quality.autoDetail',
        message: 'Picked for this device: {tier}',
        values: { tier: activeTier.name },
      }),
    },
    ...tiers,
  ]

  return (
    <div className="hud-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <ControlCard>
        <SegmentedRow
          label="Interface"
          onChange={(choice) => useTheme.getState().setChoice(choice)}
          options={[
            { id: 'system', label: 'System', icon: MonitorIcon },
            { id: 'light', label: 'Light', icon: Sun },
            { id: 'dark', label: 'Dark', icon: Moon },
          ]}
          value={themeChoice}
        />
      </ControlCard>

      <ControlCard>
        <SwitchRow
          checked={shadows}
          icon={Contrast}
          label={i18n._({ id: 'viewer.display.shadows', message: 'Shadows' })}
          onCheckedChange={(checked) => useViewer.getState().setShadows(checked)}
        />
      </ControlCard>

      <ControlCard>
        <SegmentedRow
          label={i18n._({ id: 'viewer.display.camera', message: 'Camera' })}
          onChange={(next) => useViewer.getState().setCameraMode(next)}
          options={[
            { id: 'perspective', label: i18n._({ id: 'viewer.display.perspective', message: 'Perspective' }), icon: Camera },
            { id: 'orthographic', label: i18n._({ id: 'viewer.display.orthographic', message: 'Orthographic' }), icon: Square },
          ]}
          value={cameraMode}
        />
      </ControlCard>

      <ControlCard>
        <SegmentedRow
          label={i18n._({ id: 'viewer.display.colors', message: 'Colours' })}
          onChange={(next) => useViewer.getState().setTextures(next === 'colored')}
          options={[
            { id: 'colored', label: i18n._({ id: 'viewer.display.colored', message: 'Coloured' }), icon: Palette },
            { id: 'monochrome', label: i18n._({ id: 'viewer.display.monochrome', message: 'Monochrome' }), icon: Square },
          ]}
          value={textures ? 'colored' : 'monochrome'}
        />
      </ControlCard>

      {!textures && (
        <ControlCard>
          <SectionLabel>{i18n._({ id: 'viewer.theme.title', message: 'Scene theme' })}</SectionLabel>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={i18n._({ id: 'viewer.theme.title', message: 'Scene theme' })}>
            {SCENE_THEMES.map((theme) => {
              const selected = sceneTheme === theme.id
              const swatches = SWATCH_ROLES.map((role) => theme.clayTints?.[role] ?? CLAY_PALETTE[role])
              return (
                <button
                  aria-checked={selected}
                  className={`studio-interactive flex items-center gap-2 rounded-xl border p-2 text-left text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] ${
                    selected
                      ? 'border-[var(--glass-accent-border)] bg-[var(--glass-accent-soft)] font-semibold text-[var(--glass-accent)]'
                      : 'border-[var(--glass-border)] bg-[var(--glass-raised-soft)] font-medium text-[var(--glass-ink)] hover:border-[var(--glass-border-strong)] hover:bg-[var(--glass-raised)]'
                  }`}
                  key={theme.id}
                  onClick={() => useViewer.getState().setSceneTheme(theme.id)}
                  role="radio"
                  type="button"
                >
                  <span
                    className="grid size-6 shrink-0 grid-cols-2 overflow-hidden rounded-md border border-[var(--glass-border)]"
                    style={{ backgroundColor: theme.background }}
                  >
                    {swatches.map((color, idx) => (
                      <span key={`${theme.id}-${idx}`} style={{ backgroundColor: color }} />
                    ))}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{sceneThemeName(theme.id, theme.name, i18n)}</span>
                  {selected && <Check aria-hidden className="size-3.5 shrink-0" />}
                </button>
              )
            })}
          </div>
          <div className="border-[var(--glass-border)] border-t pt-2.5">
            <SwitchRow
              checked={edges !== 'off'}
              icon={PenLine}
              label={i18n._({ id: 'viewer.display.edges.title', message: 'Edges' })}
              onCheckedChange={(checked) => useViewer.getState().setEdges(checked ? 'soft' : 'off')}
            />
          </div>
        </ControlCard>
      )}

      <ControlCard>
        <SectionLabel right={<Gauge aria-hidden className="size-3.5 text-[var(--glass-muted)]" />}>
          {i18n._({ id: 'viewer.daylight.quality.title', message: 'Quality' })}
        </SectionLabel>
        <div
          aria-label={i18n._({ id: 'viewer.daylight.quality.title', message: 'Quality' })}
          className="flex flex-col gap-1.5"
          role="radiogroup"
        >
          {qualityOptions.map((option) => {
            const selected = qualityChoice === option.id
            return (
              <button
                aria-checked={selected}
                className={`studio-interactive flex items-start gap-2.5 rounded-xl border px-3 py-2 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] ${
                  selected
                    ? 'border-[var(--glass-accent-border)] bg-[var(--glass-accent-soft)]'
                    : 'border-[var(--glass-border)] bg-[var(--glass-raised-soft)] hover:border-[var(--glass-border-strong)] hover:bg-[var(--glass-raised)]'
                }`}
                key={option.id}
                onClick={() => useViewer.getState().setRenderQuality(option.id)}
                role="radio"
                type="button"
              >
                <div className="min-w-0 flex-1">
                  <div className={`text-[13px] leading-snug ${selected ? 'font-semibold text-[var(--glass-accent)]' : 'font-medium text-[var(--glass-ink)]'}`}>
                    {option.name}
                  </div>
                  <div className="text-[var(--glass-muted)] text-xs leading-snug">{option.detail}</div>
                </div>
                <span
                  aria-hidden
                  className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${
                    selected ? 'border-[var(--glass-accent)] bg-[var(--glass-accent)] text-white' : 'border-[var(--glass-border-strong)]'
                  }`}
                >
                  {selected && <Check className="size-2.5" />}
                </span>
              </button>
            )
          })}
        </div>
      </ControlCard>
    </div>
  )
}

// ---- Tab 4: Light (Daylight & Weather) ----------------------------------------------------------

const SKY_PRESETS: readonly { id: TimeOfDay; icon: typeof Sun }[] = [
  { id: 'midday', icon: Sun },
  { id: 'golden', icon: Sunset },
  { id: 'blue', icon: Sunrise },
  { id: 'night', icon: Moon },
]

const WEATHER_OPTIONS: readonly { id: Weather; icon: typeof Sun }[] = [
  { id: 'clear', icon: Sun },
  { id: 'fair', icon: CloudSun },
  { id: 'cloudy', icon: Cloudy },
  { id: 'overcast', icon: Cloud },
]

const PHASE_SKY: Record<SkyPhase, readonly [string, string]> = {
  night: ['#121a36', '#36406c'],
  blue: ['#263465', '#8c88b4'],
  golden: ['#8e98c6', '#f2cfb2'],
  morning: ['#6f9dd6', '#dbe7f2'],
  midday: ['#5a93d5', '#d3e4f3'],
  afternoon: ['#6a98d0', '#e6e2da'],
}

const ARC_W = 320
const ARC_H = 136
const ARC_CX = ARC_W / 2
const ARC_CY = 92
const ARC_RX = 136
const ARC_RY_DAY = 72
const ARC_RY_NIGHT = 26

function arcPoint(minutes: number, sunrise: number, sunset: number) {
  const dayLength = Math.max(60, sunset - sunrise)
  if (minutes >= sunrise && minutes <= sunset) {
    const angle = Math.PI * (1 - (minutes - sunrise) / dayLength)
    return { x: ARC_CX + ARC_RX * Math.cos(angle), y: ARC_CY - ARC_RY_DAY * Math.sin(angle), day: true }
  }
  const since = (minutes < sunrise ? minutes + 1440 : minutes) - sunset
  const angle = Math.PI * (since / Math.max(60, 1440 - dayLength))
  return { x: ARC_CX + ARC_RX * Math.cos(angle), y: ARC_CY + ARC_RY_NIGHT * Math.sin(angle), day: false }
}

function arcMinutes(x: number, y: number, sunrise: number, sunset: number) {
  const dayLength = Math.max(60, sunset - sunrise)
  const angle = Math.atan2((ARC_CY - y) / (y < ARC_CY ? ARC_RY_DAY : ARC_RY_NIGHT), (x - ARC_CX) / ARC_RX)
  const minutes = angle >= 0
    ? sunrise + (1 - angle / Math.PI) * dayLength
    : sunset + (-angle / Math.PI) * Math.max(60, 1440 - dayLength)
  return (((Math.round(minutes / 5) * 5) % 1440) + 1440) % 1440
}

function coursePath(sunrise: number, sunset: number, from: number, to: number) {
  if (to - from < 1) return ''
  const steps = Math.max(2, Math.ceil((to - from) / 8))
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const pt = arcPoint((sunrise + from + ((to - from) * i) / steps) % 1440, sunrise, sunset)
    d += `${i ? 'L' : 'M'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)} `
  }
  return d
}

const formatMinutes = (() => {
  let formatter: Intl.DateTimeFormat | null = null
  return (minutes: number) => {
    formatter ??= new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
    return formatter.format(new Date(Math.round(minutes) * 60_000))
  }
})()

function presetLabel(i18n: ReturnType<typeof usePascalI18n>, id: TimeOfDay) {
  switch (id) {
    case 'golden': return i18n._({ id: 'viewer.daylight.time.golden', message: 'Golden hour' })
    case 'midday': return i18n._({ id: 'viewer.daylight.time.midday', message: 'Midday' })
    case 'blue': return i18n._({ id: 'viewer.daylight.time.blue', message: 'Blue hour' })
    case 'night': return i18n._({ id: 'viewer.daylight.time.night', message: 'Night' })
  }
}

function phaseLabel(i18n: ReturnType<typeof usePascalI18n>, phase: SkyPhase) {
  switch (phase) {
    case 'night': return presetLabel(i18n, 'night')
    case 'blue': return presetLabel(i18n, 'blue')
    case 'golden': return presetLabel(i18n, 'golden')
    case 'midday': return presetLabel(i18n, 'midday')
    case 'morning': return i18n._({ id: 'viewer.daylight.phase.morning', message: 'Morning' })
    case 'afternoon': return i18n._({ id: 'viewer.daylight.phase.afternoon', message: 'Afternoon' })
  }
}

function weatherLabel(i18n: ReturnType<typeof usePascalI18n>, id: Weather) {
  switch (id) {
    case 'clear': return i18n._({ id: 'viewer.daylight.weather.clear', message: 'Clear' })
    case 'fair': return i18n._({ id: 'viewer.daylight.weather.fair', message: 'Fair' })
    case 'cloudy': return i18n._({ id: 'viewer.daylight.weather.cloudy', message: 'Cloudy' })
    case 'overcast': return i18n._({ id: 'viewer.daylight.weather.overcast', message: 'Overcast' })
  }
}

function LightTab() {
  const i18n = usePascalI18n()
  const textures = useViewer((s) => s.textures)
  const timeOfDay = useViewer((s) => s.timeOfDay)
  const timeOfDayMinutes = useViewer((s) => s.timeOfDayMinutes)
  const skyLive = useViewer((s) => s.skyLive)
  const weather = useViewer((s) => s.weather)
  const deviceLocation = useViewer((s) => s.deviceLocation)

  const site = useScene((state) => {
    for (const id of state.rootNodeIds) {
      const node = state.nodes[id]
      if (node?.type === 'site') return node
    }
    return undefined
  })

  const [now, setNow] = useState(() => new Date())
  const [locating, setLocating] = useState(false)
  const arcRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!skyLive) return
    setNow(new Date())
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [skyLive])

  const { location, source } = resolveLocation(site, deviceLocation)
  const { lat, lng } = location

  const day = useMemo(() => {
    const today = new Date()
    const presets: Record<TimeOfDay, number> = {
      midday: solarClockMinutes(presetInstant(today, lat, lng, 'midday'), lng),
      golden: solarClockMinutes(presetInstant(today, lat, lng, 'golden'), lng),
      blue: solarClockMinutes(presetInstant(today, lat, lng, 'blue'), lng),
      night: solarClockMinutes(presetInstant(today, lat, lng, 'night'), lng),
    }
    return { today, presets, events: sunEvents(today, lat, lng) ?? { sunrise: 6 * 60, sunset: 18 * 60 } }
  }, [lat, lng])

  if (!textures) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <span aria-hidden className="flex size-12 items-center justify-center rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg-subtle)] text-[var(--glass-muted)]">
          <Sun className="size-5" />
        </span>
        <div className="space-y-1">
          <p className="font-semibold text-[var(--glass-ink)] text-sm">Daylight is off in monochrome mode</p>
          <p className="text-[var(--glass-muted)] text-xs leading-relaxed">
            Monochrome uses your chosen scene theme lighting. Switch to coloured mode to control the sun and sky.
          </p>
        </div>
        <button
          className="studio-interactive mt-1 inline-flex h-9 items-center justify-center rounded-full bg-[var(--glass-accent)] px-4 font-semibold text-white text-xs shadow-xs transition-all hover:bg-[var(--glass-accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)]"
          onClick={() => useViewer.getState().setTextures(true)}
          type="button"
        >
          Switch to coloured mode
        </button>
      </div>
    )
  }

  const minutes = skyLive
    ? solarClockMinutes(now, lng)
    : (timeOfDayMinutes ?? day.presets[timeOfDay])
  const clock = skyLive ? now.getHours() * 60 + now.getMinutes() : minutes
  const elevation = solarPosition(solarClockInstant(day.today, lng, minutes), lat, lng).elevation
  const phase = skyPhase(elevation, minutes)
  const activePreset = skyLive || timeOfDayMinutes !== null ? null : timeOfDay
  const [skyTop, skyHorizon] = PHASE_SKY[phase]
  const sun = arcPoint(minutes, day.events.sunrise, day.events.sunset)
  const elapsed = (((minutes - day.events.sunrise) % 1440) + 1440) % 1440
  const travelled = coursePath(day.events.sunrise, day.events.sunset, 0, elapsed)
  const ahead = coursePath(day.events.sunrise, day.events.sunset, elapsed, 1440)

  const setMinutesFromArc = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = arcRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = ((event.clientX - rect.left) / rect.width) * ARC_W
    const y = ((event.clientY - rect.top) / rect.height) * ARC_H
    const next = arcMinutes(x, y, day.events.sunrise, day.events.sunset)
    const viewer = useViewer.getState()
    if (viewer.skyLive) viewer.setSkyLive(false)
    viewer.setTimeOfDayMinutes(next)
  }

  return (
    <div className="hud-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <ControlCard>
        <SectionLabel
          right={
            <button
              className="studio-interactive inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-[var(--glass-accent)] text-xs hover:bg-[var(--glass-accent-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)]"
              onClick={() => {
                const viewer = useViewer.getState()
                viewer.setTimeOfDay('midday')
                viewer.setWeather('fair')
              }}
              type="button"
            >
              <RotateCcw aria-hidden className="size-3" />
              {i18n._({ id: 'viewer.daylight.sky.reset', message: 'Reset' })}
            </button>
          }
        >
          {i18n._({ id: 'viewer.daylight.time.title', message: 'Time of day' })}
        </SectionLabel>

        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono font-semibold text-xl text-[var(--glass-ink)] tabular-nums">
            {formatMinutes(clock)}
          </span>
          <span className="rounded-full bg-[var(--glass-bg-subtle)] px-2.5 py-0.5 font-medium text-[var(--glass-ink)] text-xs">
            {phaseLabel(i18n, phase)}
          </span>
        </div>

        {/* Interactive sun-arc illustration */}
        <div
          aria-hidden
          className="cursor-grab touch-none select-none overflow-hidden rounded-xl border border-[var(--glass-border)] active:cursor-grabbing"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            setMinutesFromArc(event)
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) setMinutesFromArc(event)
          }}
          ref={arcRef}
        >
          <svg className="block w-full" viewBox={`0 0 ${ARC_W} ${ARC_H}`}>
            <defs>
              <linearGradient id="hud-sky-arc" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={skyTop} />
                <stop offset={ARC_CY / ARC_H} stopColor={skyHorizon} />
                <stop offset={ARC_CY / ARC_H} stopColor="#9aa0ad" />
                <stop offset="1" stopColor="#6c7382" />
              </linearGradient>
            </defs>
            <rect fill="url(#hud-sky-arc)" height={ARC_H} width={ARC_W} />
            <line stroke="rgba(0,0,0,0.22)" x1="0" x2={ARC_W} y1={ARC_CY} y2={ARC_CY} />
            <path d={travelled} fill="none" stroke="#1e2438" strokeLinecap="round" strokeWidth="2" />
            <path d={ahead} fill="none" stroke="#1e2438" strokeDasharray="2 5" strokeLinecap="round" strokeOpacity="0.65" strokeWidth="1.5" />
            {sun.day && <circle cx={sun.x} cy={sun.y} fill="#fcd165" opacity="0.32" r="14" />}
            <circle cx={sun.x} cy={sun.y} fill={sun.day ? '#fcd165' : '#d6dcf0'} r="8.5" stroke="#ffffff" strokeWidth="2.5" />
          </svg>
        </div>

        <input
          aria-label={i18n._({ id: 'viewer.daylight.time.title', message: 'Time of day' })}
          className="anim-scrub w-full cursor-pointer"
          max={1435}
          min={0}
          onChange={(event) => {
            const viewer = useViewer.getState()
            if (viewer.skyLive) viewer.setSkyLive(false)
            viewer.setTimeOfDayMinutes(Number(event.target.value))
          }}
          step={5}
          style={{
            ['--anim-accent' as string]: '#2649c4',
            ['--anim-progress' as string]: `${(Math.min(1435, Math.max(0, minutes)) / 1435) * 100}%`,
          }}
          type="range"
          value={Math.round(minutes / 5) * 5}
        />

        <div className="flex items-center justify-between text-[var(--glass-muted)] text-xs">
          <span className="flex items-center gap-1.5">
            <Sunrise aria-hidden className="size-3.5" />
            {i18n._({ id: 'viewer.daylight.sky.sunrise', message: 'Sunrise' })}
            <span className="font-mono font-medium text-[var(--glass-ink)] tabular-nums">
              {formatMinutes(day.events.sunrise)}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            {i18n._({ id: 'viewer.daylight.sky.sunset', message: 'Sunset' })}
            <span className="font-mono font-medium text-[var(--glass-ink)] tabular-nums">
              {formatMinutes(day.events.sunset)}
            </span>
            <Sunset aria-hidden className="size-3.5" />
          </span>
        </div>

        <div className="grid grid-cols-4 gap-1.5 pt-1">
          {SKY_PRESETS.map((preset) => {
            const Icon = preset.icon
            const active = activePreset === preset.id
            const label = presetLabel(i18n, preset.id)
            return (
              <button
                aria-pressed={active}
                className={`studio-interactive flex flex-col items-center gap-0.5 rounded-xl border px-1 py-2 text-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] ${
                  active
                    ? 'border-[var(--glass-accent-border)] bg-[var(--glass-accent-soft)] font-semibold text-[var(--glass-accent)]'
                    : 'border-[var(--glass-border)] bg-[var(--glass-raised-soft)] text-[var(--glass-ink)] hover:border-[var(--glass-border-strong)] hover:bg-[var(--glass-raised)]'
                }`}
                key={preset.id}
                onClick={() => useViewer.getState().setTimeOfDay(preset.id)}
                type="button"
              >
                <Icon aria-hidden className={`mb-0.5 size-4 ${active ? 'text-[var(--glass-accent)]' : 'text-amber-700'}`} />
                <span className="text-[11px] leading-tight">{label}</span>
                <span className="font-mono text-[10px] text-[var(--glass-muted)] tabular-nums">
                  {formatMinutes(day.presets[preset.id])}
                </span>
              </button>
            )
          })}
        </div>
      </ControlCard>

      <ControlCard>
        <SwitchRow
          checked={skyLive}
          detail={i18n._({ id: 'viewer.daylight.sky.followClockDetail', message: 'The sun moves with your local clock.' })}
          icon={Sun}
          label={i18n._({ id: 'viewer.daylight.sky.followClock', message: 'Live clock' })}
          onCheckedChange={(live) => useViewer.getState().setSkyLive(live)}
        />
        <div className="border-[var(--glass-border)] border-t pt-2.5">
          <SwitchRow
            checked={source === 'device' || source === 'site'}
            detail={
              source === 'site'
                ? 'Using the site’s geocoded location.'
                : source === 'device'
                  ? i18n._({ id: 'viewer.daylight.location.device', message: 'Sun follows your location' })
                  : i18n._({ id: 'viewer.daylight.location.approximate', message: 'Sun position is approximate' })
            }
            disabled={locating || source === 'site'}
            icon={LocateFixed}
            label={i18n._({ id: 'viewer.daylight.location.use', message: 'Use my location' })}
            onCheckedChange={(useLoc) => {
              if (source === 'site') return
              if (!useLoc) {
                useViewer.getState().setDeviceLocation(null)
                return
              }
              setLocating(true)
              requestDeviceLocation()
                .then((loc) => useViewer.getState().setDeviceLocation(loc))
                .catch(() => {})
                .finally(() => setLocating(false))
            }}
          />
        </div>
      </ControlCard>

      <ControlCard>
        <SectionLabel right={<span className="font-medium text-[var(--glass-ink)] text-xs">{weatherLabel(i18n, weather)}</span>}>
          {i18n._({ id: 'viewer.daylight.sky.cloudCover', message: 'Cloud cover' })}
        </SectionLabel>
        <div className="grid grid-cols-4 gap-1.5">
          {WEATHER_OPTIONS.map((option) => {
            const Icon = option.icon
            const active = weather === option.id
            const label = weatherLabel(i18n, option.id)
            return (
              <button
                aria-pressed={active}
                className={`studio-interactive flex flex-col items-center gap-0.5 rounded-xl border px-1 py-2 text-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] ${
                  active
                    ? 'border-[var(--glass-accent-border)] bg-[var(--glass-accent-soft)] font-semibold text-[var(--glass-accent)]'
                    : 'border-[var(--glass-border)] bg-[var(--glass-raised-soft)] text-[var(--glass-ink)] hover:border-[var(--glass-border-strong)] hover:bg-[var(--glass-raised)]'
                }`}
                key={option.id}
                onClick={() => useViewer.getState().setWeather(option.id)}
                type="button"
              >
                <Icon aria-hidden className={`mb-0.5 size-4 ${active ? 'text-[var(--glass-accent)]' : 'text-[var(--glass-muted)]'}`} />
                <span className="text-[11px] leading-tight">{label}</span>
                <span className="font-mono text-[10px] text-[var(--glass-muted)] tabular-nums">
                  {Math.round(WEATHER_COVER[option.id] * 100)}%
                </span>
              </button>
            )
          })}
        </div>
      </ControlCard>
    </div>
  )
}

// ---- Inspector Drawer ---------------------------------------------------------------------------

export function Inspector({ open, tab, onOpenChange, onTabChange, glbActive, glbHasScans, glbHasGuides }: {
  open: boolean
  tab: InspectorTabId
  onOpenChange: (open: boolean) => void
  onTabChange: (tab: InspectorTabId) => void
  glbActive: boolean
  glbHasScans: boolean
  glbHasGuides: boolean
}) {
  const isMobile = useIsMobile()
  const walkthroughMode = useViewer((s) => s.walkthroughMode)
  const tabRefs = useRef<Partial<Record<InspectorTabId, HTMLButtonElement | null>>>({})

  // Escape closes the Inspector, unless the user is typing in an input or inside walkthrough.
  useEffect(() => {
    if (!open || walkthroughMode) return
    const onKeyDown = (event: KeyboardEvent | globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !isTypingTarget(event.target)) {
        onOpenChange(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, walkthroughMode, onOpenChange])

  if (walkthroughMode) return null

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex = -1
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = TABS.length - 1
    if (nextIndex < 0) return
    event.preventDefault()
    const nextTab = TABS[nextIndex]
    if (!nextTab) return
    onTabChange(nextTab.id)
    tabRefs.current[nextTab.id]?.focus()
  }

  const drawerContent = (
    <aside
      aria-label="Settings"
      className={
        isMobile
          ? 'corner-smooth studio-hud-light relative z-10 mx-3 mb-3 flex max-h-[72dvh] w-full flex-col overflow-hidden rounded-[20px]'
          : 'corner-smooth studio-hud-light pointer-events-auto absolute top-4 right-4 bottom-[4.75rem] z-40 flex w-[340px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[20px] xl:bottom-4'
      }
      data-inspector="open"
    >
      <div className="flex shrink-0 items-center gap-2 border-[var(--glass-border)] border-b px-3 py-2.5">
        <div
          aria-label="Settings sections"
          className="grid flex-1 grid-cols-3 gap-0.5 rounded-full bg-[var(--glass-bg-subtle)] p-0.5"
          role="tablist"
        >
          {TABS.map((item, index) => {
            const selected = tab === item.id
            return (
              <button
                aria-controls={`inspector-panel-${item.id}`}
                aria-selected={selected}
                className={`studio-interactive flex h-8 items-center justify-center rounded-full px-2 text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] ${
                  selected
                    ? 'bg-[var(--glass-raised)] font-semibold text-[var(--glass-accent)] shadow-xs'
                    : 'font-medium text-[var(--glass-muted)] hover:text-[var(--glass-ink)]'
                }`}
                id={`inspector-tab-${item.id}`}
                key={item.id}
                onClick={() => onTabChange(item.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                ref={(el) => { tabRefs.current[item.id] = el }}
                role="tab"
                tabIndex={selected ? 0 : -1}
                type="button"
              >
                {item.label}
              </button>
            )
          })}
        </div>

        <button
          aria-label="Close settings"
          className="studio-interactive flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--glass-muted)] transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--glass-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)]"
          onClick={() => onOpenChange(false)}
          title="Close settings"
          type="button"
        >
          <X className="size-4" />
        </button>
      </div>

      <div
        aria-labelledby={`inspector-tab-${tab}`}
        className="flex min-h-0 flex-1 flex-col"
        id={`inspector-panel-${tab}`}
        role="tabpanel"
      >
        {tab === 'scene' && (
          <SceneTab glbActive={glbActive} glbHasGuides={glbHasGuides} glbHasScans={glbHasScans} />
        )}
        {tab === 'look' && <LookTab />}
        {tab === 'light' && <LightTab />}
      </div>
    </aside>
  )

  if (!open) {
    return (
      <div className="pointer-events-none absolute top-4 right-4 z-40">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-expanded={false}
              aria-label="Open settings"
              className="studio-hud-light studio-interactive pointer-events-auto relative flex size-10 items-center justify-center rounded-full text-[var(--glass-ink)] transition-transform hover:bg-[var(--glass-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] active:scale-95"
              onClick={() => onOpenChange(true)}
              type="button"
            >
              <SlidersHorizontal className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Open settings</TooltipContent>
        </Tooltip>
      </div>
    )
  }

  if (isMobile) {
    return (
      <div className="fixed inset-0 z-50 flex items-end">
        <button
          aria-label="Close settings"
          className="absolute inset-0 bg-slate-950/20 backdrop-blur-[2px]"
          onClick={() => onOpenChange(false)}
          type="button"
        />
        {drawerContent}
      </div>
    )
  }

  return drawerContent
}
