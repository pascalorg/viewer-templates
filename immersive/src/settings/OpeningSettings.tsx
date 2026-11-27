import { useViewer } from '@pascal-app/viewer'
import { useShallow } from 'zustand/react/shallow'
import { SettingsOptions, SettingsRow, SettingsSection, type ViewerSettingsHandle } from '../pascal-react'
import {
  type ImmersiveSettings,
  OPENING_TIMES,
  OPENING_WALLS,
  roundPose,
  TIME_LABELS,
  VIEWER_DEFAULTS,
  WALL_LABELS,
  withOpening,
} from './opening'
import { cameraPose, screenLook, showTime, showWalls } from './viewer-actions'

type Choice<T extends string> = T | 'default'

const choices = <T extends string>(ids: readonly T[], labels: Record<T, string>) =>
  [{ value: 'default' as const, label: 'Default' }, ...ids.map((id) => ({ value: id, label: labels[id] }))]

/**
 * The Customize panel's opening view: camera, time of day and, when the building is drawn live,
 * walls. Choosing a time or walls shows it on screen too; "Use current view" takes the
 * camera and the look from the screen. Below, a line says when the screen differs from Save.
 */
export function OpeningSettings({ settings, glbActive }: {
  settings: ViewerSettingsHandle<ImmersiveSettings>
  /** A bake keeps its own walls: the walls choice is hidden, as in the Show popover. */
  glbActive: boolean
}) {
  const view = useViewer(useShallow(({ timeOfDay, timeOfDayMinutes, skyLive, wallMode, walkthroughMode }) =>
    ({ timeOfDay, timeOfDayMinutes, skyLive, wallMode, walkthroughMode })))
  const screen = screenLook(view)
  const walking = view.walkthroughMode
  const saved = settings.value.opening

  const captureView = () => {
    const pose = cameraPose()
    settings.set((current) => withOpening(current, {
      ...(pose ? { camera: roundPose(pose) } : {}),
      ...(screen.time ? { time: screen.time } : {}),
      ...(screen.walls && !glbActive ? { walls: screen.walls } : {}),
    }))
  }

  const effective = {
    time: saved?.time ?? VIEWER_DEFAULTS.time,
    walls: saved?.walls ?? VIEWER_DEFAULTS.walls,
  }
  const differs: string[] = []
  if (screen.time !== effective.time) differs.push(screen.time ? TIME_LABELS[screen.time] : 'a custom time')
  if (!glbActive && screen.walls && screen.walls !== effective.walls) differs.push(`${WALL_LABELS[screen.walls]} walls`)

  return (
    <SettingsSection description="What visitors see once the page has opened." title="Opening view">
      <div className="pascal-settings-row-controls">
        <button className="pascal-settings-button pascal-settings-primary" disabled={walking} onClick={captureView} type="button"
          title={walking ? 'Leave the walkthrough to use the current view' : undefined}>
          Use current view
        </button>
      </div>
      <p className="pascal-settings-hint">
        Sets the camera{glbActive ? ' and time of day' : ', time of day and walls'} from the screen.
      </p>

      <SettingsRow label="Camera" value={saved?.camera ? 'Custom' : 'Default (frames the house)'}>
        <button aria-label="Use current camera" className="pascal-settings-button" disabled={walking} type="button"
          onClick={() => {
            const pose = cameraPose()
            if (pose) settings.set((current) => withOpening(current, { camera: roundPose(pose) }))
          }}>
          Use current
        </button>
        <button aria-label="Clear camera" className="pascal-settings-button" disabled={!saved?.camera} type="button"
          onClick={() => settings.set((current) => withOpening(current, { camera: undefined }))}>
          Clear
        </button>
      </SettingsRow>

      <SettingsRow label="Time of day"
        value={saved?.time ? TIME_LABELS[saved.time] : `Default (${TIME_LABELS[VIEWER_DEFAULTS.time]})`}>
        <SettingsOptions<Choice<(typeof OPENING_TIMES)[number]>>
          label="Time of day"
          onChange={(time) => {
            settings.set((current) => withOpening(current, { time: time === 'default' ? undefined : time }))
            showTime(time === 'default' ? VIEWER_DEFAULTS.time : time)
          }}
          options={choices(OPENING_TIMES, TIME_LABELS)}
          value={saved?.time ?? 'default'}
        />
      </SettingsRow>

      {!glbActive ? (
        <SettingsRow label="Walls"
          value={saved?.walls ? WALL_LABELS[saved.walls] : `Default (${WALL_LABELS[VIEWER_DEFAULTS.walls]})`}>
          <SettingsOptions<Choice<(typeof OPENING_WALLS)[number]>>
            label="Walls"
            onChange={(walls) => {
              settings.set((current) => withOpening(current, { walls: walls === 'default' ? undefined : walls }))
              showWalls(walls === 'default' ? VIEWER_DEFAULTS.walls : walls)
            }}
            options={choices(OPENING_WALLS, WALL_LABELS)}
            value={saved?.walls ?? 'default'}
          />
        </SettingsRow>
      ) : null}

      {settings.canConfigure && differs.length > 0 ? (
        <p className="pascal-settings-hint" data-differs="true">
          On screen now: {differs.join(', ')}. Visitors won't see that unless you use the current view or choose it above.
        </p>
      ) : null}
    </SettingsSection>
  )
}
