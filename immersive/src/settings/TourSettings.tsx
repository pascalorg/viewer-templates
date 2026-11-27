import { useLocale, usePascalI18n } from '@pascal-app/core'
import type { ViewerSource } from '@pascal-app/viewer/ui'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useMemo } from 'react'
import { SettingsOptions, SettingsRow, SettingsSection, type ViewerSettingsHandle } from '../pascal-react'
import { tourFloors } from '../tour/stops'
import { type ImmersiveSettings, moveRoom, toggleRoom, tourOrder, withTour } from './opening'

/**
 * The Customize panel's guided tour: the route's rooms floor by floor, each with a switch to keep
 * it in the tour or skip it and buttons to move it up or down its floor, plus whether the tour
 * starts by itself. With nothing saved the list is the viewer's own order; the first change
 * writes that whole order, so what is saved is always the complete route.
 */
export function TourSettings({ settings, source }: {
  settings: ViewerSettingsHandle<ImmersiveSettings>
  source: ViewerSource
}) {
  const i18n = usePascalI18n()
  const locale = useLocale()
  const route = useMemo(() => tourFloors(source.nodes, i18n, locale), [source.nodes, i18n, locale])
  const tour = settings.value.tour
  const floors = useMemo(() => tourOrder(route, tour), [route, tour])
  const skipped = new Set(tour?.skip ?? [])
  const roomCount = route.reduce((sum, floor) => sum + floor.stops.length, 0)
  const included = roomCount - route.reduce((sum, floor) => sum + floor.stops.filter((stop) => skipped.has(stop.zoneId)).length, 0)
  const customised = Boolean(tour?.order || tour?.skip)
  const autostart = tour?.autostart === true
  const fullOrder = () => floors.flatMap((floor) => floor.stops.map((stop) => stop.zoneId))

  const move = (zoneId: string, step: -1 | 1) =>
    settings.set((current) => withTour(current, { order: moveRoom(route, current.tour, zoneId, step) }))
  const toggle = (zoneId: string, keep: boolean) =>
    settings.set((current) => withTour(current, {
      order: current.tour?.order ?? fullOrder(),
      skip: toggleRoom(current.tour, zoneId, keep),
    }))

  return (
    <SettingsSection description="The rooms the guided tour visits, in order, floor by floor." title="Guided tour">
      {roomCount === 0 ? (
        <p className="pascal-settings-hint">This project has no rooms for the tour yet.</p>
      ) : (
        <div aria-label="Tour rooms" className="immersive-tour-route" role="group">
          <div className="pascal-settings-row-head">
            <span className="pascal-settings-label">Rooms</span>
            <span className="pascal-settings-value">
              {customised ? `${included} of ${roomCount} in the tour` : `Default order (${roomCount} rooms)`}
            </span>
          </div>
          {floors.map((floor) => (
            <div className="immersive-tour-floor" key={floor.levelId}>
              {floors.length > 1 ? <p className="immersive-tour-floor-name">{floor.name}</p> : null}
              <ol aria-label={floors.length > 1 ? floor.name : 'Rooms'} className="immersive-tour-rooms">
                {floor.stops.map((stop, index) => {
                  const keep = !skipped.has(stop.zoneId)
                  return (
                    <li className="immersive-tour-room" data-skipped={!keep || undefined} key={stop.zoneId}>
                      <label className="immersive-tour-room-toggle">
                        <input checked={keep} onChange={(event) => toggle(stop.zoneId, event.target.checked)} type="checkbox"
                          aria-label={`Include ${stop.label} in the tour`} />
                        <span aria-hidden="true" className="immersive-tour-dot" style={{ background: stop.color }} />
                        <span className="immersive-tour-room-label">{stop.label}</span>
                      </label>
                      <span className="immersive-tour-room-moves">
                        <button aria-label={`Move ${stop.label} up`} className="pascal-settings-icon-button" disabled={index === 0}
                          onClick={() => move(stop.zoneId, -1)} type="button">
                          <ChevronUp aria-hidden="true" size={14} />
                        </button>
                        <button aria-label={`Move ${stop.label} down`} className="pascal-settings-icon-button"
                          disabled={index === floor.stops.length - 1} onClick={() => move(stop.zoneId, 1)} type="button">
                          <ChevronDown aria-hidden="true" size={14} />
                        </button>
                      </span>
                    </li>
                  )
                })}
              </ol>
            </div>
          ))}
          <div className="pascal-settings-row-controls">
            <button className="pascal-settings-button" disabled={!customised} type="button"
              onClick={() => settings.set((current) => withTour(current, { order: undefined, skip: undefined }))}>
              Use the default order
            </button>
          </div>
          {included === 0 ? <p className="pascal-settings-hint">Every room is skipped: the tour button stays off for visitors.</p> : null}
          <p className="pascal-settings-hint">Start the tour from the bottom bar to preview the route before saving.</p>
        </div>
      )}

      <SettingsRow label="Start on arrival" value={autostart ? 'On' : 'Off (visitors start it)'}>
        <SettingsOptions<'off' | 'on'>
          label="Start the guided tour on arrival"
          onChange={(next) => settings.set((current) => withTour(current, { autostart: next === 'on' ? true : undefined }))}
          options={[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }]}
          value={autostart ? 'on' : 'off'}
        />
      </SettingsRow>
    </SettingsSection>
  )
}
