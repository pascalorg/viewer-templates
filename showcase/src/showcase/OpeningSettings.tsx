import { useViewer } from '@pascal-app/viewer'
import { useShallow } from 'zustand/react/shallow'
import { SettingsOptions, SettingsRow, SettingsSection, type ViewerSettingsHandle } from '../pascal-react'
import { defaultView, MODES, modeOf, moodOf, MOODS, type ModeId, type MoodId } from './modes'
import { OPENING_MODES, resolveOpening, roundPose, type ShowcaseSettings, withOpening } from './opening'
import { cameraPose } from './presentation'
import { glideToMood, moodMinutes, useGlideTarget } from './time'
import { applyMode, type SceneContext } from './viewer-actions'

type OpeningMode = (typeof OPENING_MODES)[number]
const label = (id: string) => [...MODES, ...MOODS].find((entry) => entry.id === id)?.label ?? id

/**
 * The showcase's fields in the Customize panel: the opening view's camera, time of day and mode,
 * each saying what is set. Choosing a time or a mode shows it on screen too; "Use current view"
 * takes all three from the screen. Below, a line says when the screen differs from what Save keeps.
 */
export function OpeningSettings({ settings, levelCount, offeredModes, context }: {
  settings: ViewerSettingsHandle<ShowcaseSettings>
  levelCount: number
  /** The modes this page offers (`availableModes`). */
  offeredModes: readonly ModeId[]
  /** The scene the Cut view and X-ray read when a mode is chosen here. */
  context: () => SceneContext
}) {
  const view = useViewer(useShallow(({ levelMode, walkthroughMode, walkthroughMovement, sectionEnabled, xrayFamily, timeOfDay, timeOfDayMinutes }) =>
    ({ levelMode, walkthroughMode, walkthroughMovement, sectionEnabled, xrayFamily, timeOfDay, timeOfDayMinutes })))
  const glide = useGlideTarget()
  const screenMode = modeOf(view)
  const screenMood: MoodId | null = glide ?? moodOf(view, moodMinutes)
  const walking = view.walkthroughMode

  const saved = settings.value.opening
  const modes = OPENING_MODES.filter((mode) => offeredModes.includes(mode))
  const initial = defaultView(levelCount)
  const effective = resolveOpening(saved, levelCount, offeredModes)
  const savedMode: OpeningMode | 'default' = saved?.mode && modes.includes(saved.mode) ? saved.mode : 'default'

  const captureView = () => {
    const pose = cameraPose()
    settings.set((current) => withOpening(current, {
      ...(pose ? { camera: roundPose(pose) } : {}),
      ...(screenMood ? { time: screenMood } : {}),
      ...(screenMode && (OPENING_MODES as readonly string[]).includes(screenMode) ? { mode: screenMode as OpeningMode } : {}),
    }))
  }

  const differs: string[] = []
  if (screenMood && screenMood !== effective.mood) differs.push(label(screenMood))
  if (screenMode && screenMode !== 'walkthrough' && screenMode !== effective.mode) differs.push(label(screenMode))

  return (
    <SettingsSection description="What visitors see once the page has opened." title="Opening view">
      <div className="pascal-settings-row-controls">
        <button className="pascal-settings-button pascal-settings-primary" disabled={walking} onClick={captureView} type="button"
          title={walking ? 'Leave the walkthrough to use the current view' : undefined}>
          Use current view
        </button>
      </div>
      <p className="pascal-settings-hint">Sets the camera, time of day and mode from the screen.</p>

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

      <SettingsRow label="Time of day" value={saved?.time ? label(saved.time) : `Default (${label(initial.mood)})`}>
        <SettingsOptions<MoodId | 'default'>
          label="Time of day"
          onChange={(time) => {
            settings.set((current) => withOpening(current, { time: time === 'default' ? undefined : time }))
            glideToMood(time === 'default' ? initial.mood : time)
          }}
          options={[{ value: 'default', label: 'Default' }, ...MOODS.map(({ id, label }) => ({ value: id, label }))]}
          value={saved?.time ?? 'default'}
        />
      </SettingsRow>

      <SettingsRow label="Mode" value={savedMode !== 'default' ? label(savedMode) : `Default (${label(initial.mode)})`}>
        <SettingsOptions<OpeningMode | 'default'>
          disabled={walking}
          label="Mode"
          onChange={(mode) => {
            settings.set((current) => withOpening(current, { mode: mode === 'default' ? undefined : mode }))
            applyMode(mode === 'default' ? initial.mode : mode, context())
          }}
          options={[{ value: 'default', label: 'Default' }, ...modes.map((id) => ({ value: id, label: label(id) }))]}
          value={savedMode}
        />
      </SettingsRow>

      {settings.canConfigure && differs.length > 0 ? (
        <p className="pascal-settings-hint" data-differs="true">
          On screen now: {differs.join(', ')}. Visitors won't see that unless you use the current view or choose it above.
        </p>
      ) : null}
    </SettingsSection>
  )
}
