/* Ported from home-assistant/frontend (Apache-2.0):
   - src/common/translations/entity-state.ts
   - src/common/entity/compute_state_display.ts
   - src/common/entity/compute_attribute_display.ts
   - src/common/number/format_number.ts
   - src/common/translations/blank_before_unit.ts & blank_before_percent.ts
   - src/data/entity/entity_attributes.ts
   - src/data/icons.ts (entityIcon & attributeIcon lookup order) */

import { useMemo } from 'react'
import { domainOf, type HassEntity } from '../entities'
import {
  DEFAULT_UNIT_SYSTEM,
  type EntityRegistryInfo,
  type HassIcons,
  type IconTranslationEntry,
  type UnitSystem,
  useHass,
} from './connection'

/** Bundled English fallback for HA UI strings and core entity_component strings used offline. */
export const FALLBACK_RESOURCES: Readonly<Record<string, string>> = {
  // Default states
  'state.default.unknown': 'Unknown',
  'state.default.unavailable': 'Unavailable',
  'state.default.on': 'On',
  'state.default.off': 'Off',

  // Common UI strings from home-assistant/frontend src/translations/en.json
  'ui.common.close': 'Close',
  'ui.common.cancel': 'Cancel',
  'ui.common.none': 'None',
  'ui.common.set': 'Set',
  'ui.card.common.turn_on': 'Turn on',
  'ui.card.common.turn_off': 'Turn off',
  'ui.card.common.toggle': 'Toggle',
  'ui.components.relative_time.never': 'Never',
  'ui.dialogs.more_info_control.attributes': 'Attributes',
  'ui.dialogs.more_info_control.entity': 'Entity',
  'ui.dialogs.more_info_control.entity_id': 'Entity ID',
  'ui.dialogs.more_info_control.state': 'State',
  'ui.dialogs.more_info_control.last_changed': 'Last changed',
  'ui.dialogs.more_info_control.last_updated': 'Last updated',
  'ui.dialogs.enter_code.code': 'Code',
  'ui.dialogs.enter_code.clear': 'Clear',
  'ui.dialogs.enter_code.invalid_code': 'Invalid code',

  // Siren UI strings
  'ui.components.siren.more_controls': 'More controls',
  'ui.components.siren.tone': 'Tone',
  'ui.components.siren.volume': 'Volume',
  'ui.components.siren.duration': 'Duration',

  // Light UI strings
  'ui.dialogs.more_info_control.light.toggle': 'Toggle',
  'ui.dialogs.more_info_control.light.color': 'Color',
  'ui.dialogs.more_info_control.light.color_temp': 'Color temperature',
  'ui.dialogs.more_info_control.light.set_white': 'Set white',
  'ui.dialogs.more_info_control.light.favorite_color.set': 'Set favorite color {number}',
  'ui.card.light.color_brightness': 'Color brightness',
  'ui.card.light.white_value': 'White',
  'ui.card.light.cold_white_value': 'Cold white',
  'ui.card.light.warm_white_value': 'Warm white',

  // Fan UI strings
  'ui.card.fan.speed.low': 'Low',
  'ui.card.fan.speed.medium': 'Medium',
  'ui.card.fan.speed.high': 'High',
  'ui.card.fan.speed.numbered': 'Speed {speed}',

  // Cover UI strings
  'ui.card.cover.position': 'Position',
  'ui.card.cover.tilt_position': 'Tilt position',
  'ui.card.cover.open_cover': 'Open cover',
  'ui.card.cover.close_cover': 'Close cover',
  'ui.card.cover.stop_cover': 'Stop cover',
  'ui.card.cover.open_tilt_cover': 'Open tilt',
  'ui.card.cover.close_tilt_cover': 'Close tilt',
  'ui.dialogs.more_info_control.cover.open': 'Open',
  'ui.dialogs.more_info_control.cover.stop': 'Stop',
  'ui.dialogs.more_info_control.cover.close': 'Close',
  'ui.dialogs.more_info_control.cover.currently': 'Currently {value}',
  'ui.dialogs.more_info_control.cover.currently_unknown': 'Current position unknown',
  'ui.dialogs.more_info_control.cover.requested': 'Requested {value}',
  'ui.dialogs.more_info_control.cover.requested_open': 'Requested open',
  'ui.dialogs.more_info_control.cover.requested_closed': 'Requested closed',
  'ui.dialogs.more_info_control.cover.opens_on_release': 'Opens on release',
  'ui.dialogs.more_info_control.cover.closes_on_release': 'Closes on release',
  'ui.dialogs.more_info_control.cover.favorite_position.set': 'Set position to {value}',
  'ui.dialogs.more_info_control.cover.favorite_tilt_position.set': 'Set tilt to {value}',

  // Valve UI strings
  'ui.card.valve.open_valve': 'Open valve',
  'ui.card.valve.close_valve': 'Close valve',
  'ui.card.valve.stop_valve': 'Stop valve',
  'ui.dialogs.more_info_control.valve.switch_mode.position': 'Position',
  'ui.dialogs.more_info_control.valve.switch_mode.button': 'Buttons',
  'ui.dialogs.more_info_control.valve.favorite_position.set': 'Set position to {value}',

  // Lock UI strings
  'ui.card.lock.lock': 'Lock',
  'ui.card.lock.unlock': 'Unlock',
  'ui.card.lock.open': 'Open',
  'ui.card.lock.open_door': 'Open door',
  'ui.card.lock.open_door_confirm': 'Confirm?',
  'ui.card.lock.open_door_done': 'Opened',

  // Alarm control panel UI strings
  'ui.card.alarm_control_panel.arm': 'Arm',
  'ui.card.alarm_control_panel.disarm': 'Disarm',
  'ui.card.alarm_control_panel.modes_label': 'Alarm modes',
  'ui.card.alarm_control_panel.modes.armed_home': 'Home',
  'ui.card.alarm_control_panel.modes.armed_away': 'Away',
  'ui.card.alarm_control_panel.modes.armed_night': 'Night',
  'ui.card.alarm_control_panel.modes.armed_vacation': 'Vacation',
  'ui.card.alarm_control_panel.modes.armed_custom_bypass': 'Custom bypass',
  'ui.card.alarm_control_panel.modes.disarmed': 'Disarmed',

  // Humidifier UI strings
  'ui.card.humidifier.state': 'State',
  'ui.card.humidifier.mode': 'Mode',

  // Water heater UI strings
  'ui.card.water_heater.mode': 'Operation',
  'ui.card.water_heater.target': 'Target',
  'ui.card.water_heater.target_temperature': 'Target temperature',
  'ui.card.water_heater.currently': 'Currently',

  // Media player UI strings
  'ui.card.media_player.track_position': 'Track position',
  'ui.card.media_player.turn_on': 'Turn on',
  'ui.card.media_player.turn_off': 'Turn off',
  'ui.card.media_player.media_play': 'Play',
  'ui.card.media_player.media_pause': 'Pause',
  'ui.card.media_player.media_play_pause': 'Play/pause',
  'ui.card.media_player.media_stop': 'Stop',
  'ui.card.media_player.media_next_track': 'Next track',
  'ui.card.media_player.media_previous_track': 'Previous track',
  'ui.card.media_player.media_volume_up': 'Volume up',
  'ui.card.media_player.media_volume_down': 'Volume down',
  'ui.card.media_player.media_volume_mute': 'Mute',
  'ui.card.media_player.media_volume_unmute': 'Unmute',
  'ui.card.media_player.shuffle_set': 'Shuffle',
  'ui.card.media_player.repeat_set': 'Repeat',
  'ui.card.media_player.source': 'Source',
  'ui.card.media_player.sound_mode': 'Sound mode',

  // Vacuum UI strings
  'ui.dialogs.more_info_control.vacuum.start': 'Start',
  'ui.dialogs.more_info_control.vacuum.pause': 'Pause',
  'ui.dialogs.more_info_control.vacuum.start_pause': 'Start/pause',
  'ui.dialogs.more_info_control.vacuum.stop': 'Stop',
  'ui.dialogs.more_info_control.vacuum.return_home': 'Return to dock',
  'ui.dialogs.more_info_control.vacuum.locate': 'Locate',
  'ui.dialogs.more_info_control.vacuum.clean_spot': 'Clean spot',

  // Lawn mower UI strings
  'ui.dialogs.more_info_control.lawn_mower.start_mowing': 'Start mowing',
  'ui.dialogs.more_info_control.lawn_mower.pause': 'Pause',
  'ui.dialogs.more_info_control.lawn_mower.stop': 'Stop',
  'ui.dialogs.more_info_control.lawn_mower.dock': 'Return to dock',

  // Weather UI strings
  'ui.card.weather.forecast': 'Forecast',
  'ui.card.weather.daily': 'Daily',
  'ui.card.weather.twice_daily': 'Day & night',
  'ui.card.weather.hourly': 'Hourly',
  'ui.card.weather.day': 'Day',
  'ui.card.weather.night': 'Night',
  'ui.card.weather.attributes.air_pressure': 'Air pressure',
  'ui.card.weather.attributes.humidity': 'Humidity',
  'ui.card.weather.attributes.wind_speed': 'Wind speed',
  'ui.card.weather.attributes.visibility': 'Visibility',

  // Update UI strings
  'ui.dialogs.more_info_control.update.release_announcement': 'Release announcement',
  'ui.dialogs.more_info_control.update.create_backup': 'Create backup before updating',
  'ui.dialogs.more_info_control.update.skip': 'Skip',
  'ui.dialogs.more_info_control.update.clear_skipped': 'Clear skipped',
  'ui.dialogs.more_info_control.update.update': 'Update',

  // Remote, helpers & inputs UI strings
  'ui.dialogs.more_info_control.remote.activity': 'Activity',
  'ui.card.button.press': 'Press',
  'ui.card.scene.turn_on': 'Activate',
  'ui.card.select.option': 'Option',
  'ui.card.script.idle': 'Idle',
  'ui.card.script.running_single': 'Running',
  'ui.card.script.running_parallel': 'Running ({active})',
  'ui.card.script.running_queued': '{queued} queued',
  'ui.card.script.run': 'Run',
  'ui.card.script.cancel': 'Cancel',
  'ui.card.script.cancel_all': 'Cancel all',
  'ui.card.automation.last_triggered': 'Last triggered',
  'ui.card.automation.trigger': 'Run actions',
  'ui.card.timer.actions.start': 'Start',
  'ui.card.timer.actions.pause': 'Pause',
  'ui.card.timer.actions.cancel': 'Cancel',
  'ui.card.timer.actions.finish': 'Finish',
  'ui.card.counter.actions.increment': 'Increment',
  'ui.card.counter.actions.decrement': 'Decrement',
  'ui.card.counter.actions.reset': 'Reset',
  'ui.dialogs.more_info_control.sun.rising': 'Rising',
  'ui.dialogs.more_info_control.sun.setting': 'Setting',
  'ui.dialogs.more_info_control.sun.elevation': 'Elevation',
  'ui.dialogs.more_info_control.sun.azimuth': 'Azimuth',

  // Climate UI strings
  'ui.card.climate.mode': 'Mode',
  'ui.card.climate.humidity_target': 'Humidity target',
  'ui.dialogs.more_info_control.climate.temperature': 'Temperature',
  'ui.dialogs.more_info_control.climate.humidity': 'Humidity',
  'ui.components.climate-control.temperature_up': 'Increase temperature',
  'ui.components.climate-control.temperature_down': 'Decrease temperature',
  'ui.components.climate-control.lower_temperature_up': 'Increase lower target temperature',
  'ui.components.climate-control.lower_temperature_down': 'Decrease lower target temperature',
  'ui.components.climate-control.upper_temperature_up': 'Increase upper target temperature',
  'ui.components.climate-control.upper_temperature_down': 'Decrease upper target temperature',
  'ui.components.climate-control.humidity_up': 'Increase humidity',
  'ui.components.climate-control.humidity_down': 'Decrease humidity',

  // Common attribute names
  'ui.components.attributes.names.assumed_state': 'Assumed state',
  'ui.components.attributes.names.attribution': 'Attribution',
  'ui.components.attributes.names.device_class': 'Device class',
  'ui.components.attributes.names.entity_picture': 'Entity picture',
  'ui.components.attributes.names.friendly_name': 'Friendly name',
  'ui.components.attributes.names.icon': 'Icon',
  'ui.components.attributes.names.supported_features': 'Supported features',
  'ui.components.attributes.names.unit_of_measurement': 'Unit of measurement',

  // Toggle domain entity_component strings
  'component.switch.entity_component._.name': 'Switch',
  'component.switch.entity_component._.state.on': 'On',
  'component.switch.entity_component._.state.off': 'Off',
  'component.input_boolean.entity_component._.name': 'Input boolean',
  'component.input_boolean.entity_component._.state.on': 'On',
  'component.input_boolean.entity_component._.state.off': 'Off',
  'component.siren.entity_component._.name': 'Siren',
  'component.siren.entity_component._.state.on': 'On',
  'component.siren.entity_component._.state.off': 'Off',
  'component.siren.entity_component._.state_attributes.available_tones.name': 'Available tones',

  // Light entity_component strings
  'component.light.entity_component._.name': 'Light',
  'component.light.entity_component._.state.on': 'On',
  'component.light.entity_component._.state.off': 'Off',
  'component.light.entity_component._.state_attributes.brightness.name': 'Brightness',
  'component.light.entity_component._.state_attributes.color_temp_kelvin.name': 'Color temperature',
  'component.light.entity_component._.state_attributes.effect.name': 'Effect',

  // Fan entity_component strings
  'component.fan.entity_component._.name': 'Fan',
  'component.fan.entity_component._.state.on': 'On',
  'component.fan.entity_component._.state.off': 'Off',
  'component.fan.entity_component._.state_attributes.direction.name': 'Direction',
  'component.fan.entity_component._.state_attributes.direction.state.forward': 'Forward',
  'component.fan.entity_component._.state_attributes.direction.state.reverse': 'Reverse',
  'component.fan.entity_component._.state_attributes.oscillating.name': 'Oscillating',
  'component.fan.entity_component._.state_attributes.oscillating.state.true': 'On',
  'component.fan.entity_component._.state_attributes.oscillating.state.false': 'Off',
  'component.fan.entity_component._.state_attributes.percentage.name': 'Speed',
  'component.fan.entity_component._.state_attributes.preset_mode.name': 'Preset mode',

  // Cover entity_component strings
  'component.cover.entity_component._.name': 'Cover',
  'component.cover.entity_component._.state.open': 'Open',
  'component.cover.entity_component._.state.closed': 'Closed',
  'component.cover.entity_component._.state.opening': 'Opening',
  'component.cover.entity_component._.state.closing': 'Closing',
  'component.cover.entity_component._.state_attributes.current_position.name': 'Position',
  'component.cover.entity_component._.state_attributes.current_tilt_position.name': 'Tilt position',

  // Valve entity_component strings
  'component.valve.entity_component._.name': 'Valve',
  'component.valve.entity_component._.state.open': 'Open',
  'component.valve.entity_component._.state.closed': 'Closed',
  'component.valve.entity_component._.state.opening': 'Opening',
  'component.valve.entity_component._.state.closing': 'Closing',
  'component.valve.entity_component._.state_attributes.current_position.name': 'Position',

  // Lock entity_component strings
  'component.lock.entity_component._.name': 'Lock',
  'component.lock.entity_component._.state.locked': 'Locked',
  'component.lock.entity_component._.state.unlocked': 'Unlocked',
  'component.lock.entity_component._.state.locking': 'Locking',
  'component.lock.entity_component._.state.unlocking': 'Unlocking',
  'component.lock.entity_component._.state.opening': 'Opening',
  'component.lock.entity_component._.state.open': 'Open',
  'component.lock.entity_component._.state.jammed': 'Jammed',

  // Alarm control panel entity_component strings
  'component.alarm_control_panel.entity_component._.name': 'Alarm',
  'component.alarm_control_panel.entity_component._.state.disarmed': 'Disarmed',
  'component.alarm_control_panel.entity_component._.state.armed_home': 'Armed home',
  'component.alarm_control_panel.entity_component._.state.armed_away': 'Armed away',
  'component.alarm_control_panel.entity_component._.state.armed_night': 'Armed night',
  'component.alarm_control_panel.entity_component._.state.armed_vacation': 'Armed vacation',
  'component.alarm_control_panel.entity_component._.state.armed_custom_bypass': 'Armed custom bypass',
  'component.alarm_control_panel.entity_component._.state.arming': 'Arming',
  'component.alarm_control_panel.entity_component._.state.disarming': 'Disarming',
  'component.alarm_control_panel.entity_component._.state.pending': 'Pending',
  'component.alarm_control_panel.entity_component._.state.triggered': 'Triggered',

  // Humidifier entity_component strings
  'component.humidifier.entity_component._.name': 'Humidifier',
  'component.humidifier.entity_component._.state.on': 'On',
  'component.humidifier.entity_component._.state.off': 'Off',
  'component.humidifier.entity_component._.state_attributes.current_humidity.name': 'Current humidity',
  'component.humidifier.entity_component._.state_attributes.humidity.name': 'Target humidity',
  'component.humidifier.entity_component._.state_attributes.action.name': 'Action',
  'component.humidifier.entity_component._.state_attributes.action.state.humidifying': 'Humidifying',
  'component.humidifier.entity_component._.state_attributes.action.state.drying': 'Drying',
  'component.humidifier.entity_component._.state_attributes.action.state.idle': 'Idle',
  'component.humidifier.entity_component._.state_attributes.action.state.off': 'Off',
  'component.humidifier.entity_component._.state_attributes.mode.name': 'Mode',
  'component.humidifier.entity_component._.state_attributes.mode.state.normal': 'Normal',
  'component.humidifier.entity_component._.state_attributes.mode.state.eco': 'Eco',
  'component.humidifier.entity_component._.state_attributes.mode.state.away': 'Away',
  'component.humidifier.entity_component._.state_attributes.mode.state.boost': 'Boost',
  'component.humidifier.entity_component._.state_attributes.mode.state.comfort': 'Comfort',
  'component.humidifier.entity_component._.state_attributes.mode.state.home': 'Home',
  'component.humidifier.entity_component._.state_attributes.mode.state.sleep': 'Sleep',
  'component.humidifier.entity_component._.state_attributes.mode.state.auto': 'Auto',
  'component.humidifier.entity_component._.state_attributes.mode.state.baby': 'Baby',

  // Water heater entity_component strings
  'component.water_heater.entity_component._.name': 'Water heater',
  'component.water_heater.entity_component._.state.off': 'Off',
  'component.water_heater.entity_component._.state.eco': 'Eco',
  'component.water_heater.entity_component._.state.electric': 'Electric',
  'component.water_heater.entity_component._.state.gas': 'Gas',
  'component.water_heater.entity_component._.state.heat_pump': 'Heat pump',
  'component.water_heater.entity_component._.state.high_demand': 'High demand',
  'component.water_heater.entity_component._.state.performance': 'Performance',
  'component.water_heater.entity_component._.state_attributes.current_temperature.name': 'Current temperature',
  'component.water_heater.entity_component._.state_attributes.temperature.name': 'Target temperature',
  'component.water_heater.entity_component._.state_attributes.away_mode.name': 'Away mode',
  'component.water_heater.entity_component._.state_attributes.away_mode.state.on': 'On',
  'component.water_heater.entity_component._.state_attributes.away_mode.state.off': 'Off',

  // Media player entity_component strings
  'component.media_player.entity_component._.name': 'Media player',
  'component.media_player.entity_component._.state.off': 'Off',
  'component.media_player.entity_component._.state.on': 'On',
  'component.media_player.entity_component._.state.idle': 'Idle',
  'component.media_player.entity_component._.state.playing': 'Playing',
  'component.media_player.entity_component._.state.paused': 'Paused',
  'component.media_player.entity_component._.state.standby': 'Standby',
  'component.media_player.entity_component._.state.buffering': 'Buffering',
  'component.media_player.entity_component._.state_attributes.volume_level.name': 'Volume',
  'component.media_player.entity_component._.state_attributes.source.name': 'Source',
  'component.media_player.entity_component._.state_attributes.sound_mode.name': 'Sound mode',

  // Vacuum entity_component strings
  'component.vacuum.entity_component._.name': 'Vacuum',
  'component.vacuum.entity_component._.state.cleaning': 'Cleaning',
  'component.vacuum.entity_component._.state.docked': 'Docked',
  'component.vacuum.entity_component._.state.idle': 'Idle',
  'component.vacuum.entity_component._.state.paused': 'Paused',
  'component.vacuum.entity_component._.state.returning': 'Returning to dock',
  'component.vacuum.entity_component._.state.error': 'Error',
  'component.vacuum.entity_component._.state.on': 'On',
  'component.vacuum.entity_component._.state.off': 'Off',
  'component.vacuum.entity_component._.state_attributes.fan_speed.name': 'Fan speed',
  'component.vacuum.entity_component._.state_attributes.status.name': 'Status',

  // Lawn mower entity_component strings
  'component.lawn_mower.entity_component._.name': 'Lawn mower',
  'component.lawn_mower.entity_component._.state.mowing': 'Mowing',
  'component.lawn_mower.entity_component._.state.docked': 'Docked',
  'component.lawn_mower.entity_component._.state.paused': 'Paused',
  'component.lawn_mower.entity_component._.state.returning': 'Returning to dock',
  'component.lawn_mower.entity_component._.state.idle': 'Idle',
  'component.lawn_mower.entity_component._.state.error': 'Error',

  // Weather entity_component strings
  'component.weather.entity_component._.name': 'Weather',
  'component.weather.entity_component._.state.clear-night': 'Clear, night',
  'component.weather.entity_component._.state.cloudy': 'Cloudy',
  'component.weather.entity_component._.state.exceptional': 'Exceptional',
  'component.weather.entity_component._.state.fog': 'Fog',
  'component.weather.entity_component._.state.hail': 'Hail',
  'component.weather.entity_component._.state.lightning': 'Lightning',
  'component.weather.entity_component._.state.lightning-rainy': 'Lightning, rainy',
  'component.weather.entity_component._.state.partlycloudy': 'Partly cloudy',
  'component.weather.entity_component._.state.pouring': 'Pouring',
  'component.weather.entity_component._.state.rainy': 'Rainy',
  'component.weather.entity_component._.state.snowy': 'Snowy',
  'component.weather.entity_component._.state.snowy-rainy': 'Snowy, rainy',
  'component.weather.entity_component._.state.sunny': 'Sunny',
  'component.weather.entity_component._.state.windy': 'Windy',
  'component.weather.entity_component._.state.windy-variant': 'Windy',

  // Update, camera, binary_sensor, person, sun & helpers entity_component strings
  'component.update.entity_component._.state.on': 'Update available',
  'component.update.entity_component._.state.off': 'Up-to-date',
  'component.update.entity_component._.state_attributes.installed_version.name': 'Installed version',
  'component.update.entity_component._.state_attributes.latest_version.name': 'Latest version',
  'component.camera.entity_component._.state.idle': 'Idle',
  'component.camera.entity_component._.state.recording': 'Recording',
  'component.camera.entity_component._.state.streaming': 'Streaming',
  'component.camera.entity_component._.state_attributes.motion_detection.name': 'Motion detection',
  'component.person.entity_component._.state.home': 'Home',
  'component.person.entity_component._.state.not_home': 'Away',
  'component.device_tracker.entity_component._.state.home': 'Home',
  'component.device_tracker.entity_component._.state.not_home': 'Away',
  'component.device_tracker.entity_component._.state_attributes.source_type.name': 'Source',
  'component.device_tracker.entity_component._.state_attributes.battery_level.name': 'Battery',
  'component.sun.entity_component._.state.above_horizon': 'Above horizon',
  'component.sun.entity_component._.state.below_horizon': 'Below horizon',
  'component.binary_sensor.entity_component.door.state.on': 'Open',
  'component.binary_sensor.entity_component.door.state.off': 'Closed',
  'component.binary_sensor.entity_component.window.state.on': 'Open',
  'component.binary_sensor.entity_component.window.state.off': 'Closed',
  'component.binary_sensor.entity_component.motion.state.on': 'Detected',
  'component.binary_sensor.entity_component.motion.state.off': 'Clear',
  'component.binary_sensor.entity_component.smoke.state.on': 'Detected',
  'component.binary_sensor.entity_component.smoke.state.off': 'Clear',
  'component.binary_sensor.entity_component.moisture.state.on': 'Wet',
  'component.binary_sensor.entity_component.moisture.state.off': 'Dry',
  'component.binary_sensor.entity_component.connectivity.state.on': 'Connected',
  'component.binary_sensor.entity_component.connectivity.state.off': 'Disconnected',
  'component.binary_sensor.entity_component.battery.state.on': 'Low',
  'component.binary_sensor.entity_component.battery.state.off': 'Normal',
  'component.binary_sensor.entity_component.problem.state.on': 'Problem',
  'component.binary_sensor.entity_component.problem.state.off': 'OK',
  'component.binary_sensor.entity_component.running.state.on': 'Running',
  'component.binary_sensor.entity_component.running.state.off': 'Not running',
  'component.binary_sensor.entity_component.vibration.state.on': 'Detected',
  'component.binary_sensor.entity_component.vibration.state.off': 'Clear',
  'component.binary_sensor.entity_component.plug.state.on': 'Plugged in',
  'component.binary_sensor.entity_component.plug.state.off': 'Unplugged',
  'component.binary_sensor.entity_component.cold.state.on': 'Cold',
  'component.binary_sensor.entity_component.cold.state.off': 'Normal',
  'component.binary_sensor.entity_component.light.state.on': 'Light detected',
  'component.binary_sensor.entity_component.light.state.off': 'No light',
  'component.binary_sensor.entity_component.glass_break.state.on': 'Detected',
  'component.binary_sensor.entity_component.glass_break.state.off': 'Clear',
  'component.binary_sensor.entity_component.tamper.state.on': 'Tampering detected',
  'component.binary_sensor.entity_component.tamper.state.off': 'Clear',

  // Climate entity_component strings (offline fallback for /lab and missing translations)
  'component.climate.entity_component._.name': 'Thermostat',
  'component.climate.entity_component._.state.auto': 'Auto',
  'component.climate.entity_component._.state.cool': 'Cool',
  'component.climate.entity_component._.state.dry': 'Dry',
  'component.climate.entity_component._.state.fan_only': 'Fan only',
  'component.climate.entity_component._.state.heat': 'Heat',
  'component.climate.entity_component._.state.heat_cool': 'Heat/Cool',
  'component.climate.entity_component._.state.off': 'Off',
  'component.climate.entity_component._.state_attributes.current_humidity.name': 'Current humidity',
  'component.climate.entity_component._.state_attributes.current_temperature.name': 'Current temperature',
  'component.climate.entity_component._.state_attributes.fan_mode.name': 'Fan mode',
  'component.climate.entity_component._.state_attributes.fan_mode.state.auto': 'Auto',
  'component.climate.entity_component._.state_attributes.fan_mode.state.diffuse': 'Diffuse',
  'component.climate.entity_component._.state_attributes.fan_mode.state.focus': 'Focus',
  'component.climate.entity_component._.state_attributes.fan_mode.state.high': 'High',
  'component.climate.entity_component._.state_attributes.fan_mode.state.low': 'Low',
  'component.climate.entity_component._.state_attributes.fan_mode.state.medium': 'Medium',
  'component.climate.entity_component._.state_attributes.fan_mode.state.middle': 'Middle',
  'component.climate.entity_component._.state_attributes.fan_mode.state.off': 'Off',
  'component.climate.entity_component._.state_attributes.fan_mode.state.on': 'On',
  'component.climate.entity_component._.state_attributes.fan_mode.state.top': 'Top',
  'component.climate.entity_component._.state_attributes.humidity.name': 'Target humidity',
  'component.climate.entity_component._.state_attributes.hvac_action.name': 'Current action',
  'component.climate.entity_component._.state_attributes.hvac_action.state.cooling': 'Cooling',
  'component.climate.entity_component._.state_attributes.hvac_action.state.defrosting': 'Defrosting',
  'component.climate.entity_component._.state_attributes.hvac_action.state.drying': 'Drying',
  'component.climate.entity_component._.state_attributes.hvac_action.state.fan': 'Fan',
  'component.climate.entity_component._.state_attributes.hvac_action.state.heating': 'Heating',
  'component.climate.entity_component._.state_attributes.hvac_action.state.idle': 'Idle',
  'component.climate.entity_component._.state_attributes.hvac_action.state.off': 'Off',
  'component.climate.entity_component._.state_attributes.hvac_action.state.preheating': 'Preheating',
  'component.climate.entity_component._.state_attributes.preset_mode.name': 'Preset',
  'component.climate.entity_component._.state_attributes.preset_mode.state.activity': 'Activity',
  'component.climate.entity_component._.state_attributes.preset_mode.state.away': 'Away',
  'component.climate.entity_component._.state_attributes.preset_mode.state.boost': 'Boost',
  'component.climate.entity_component._.state_attributes.preset_mode.state.comfort': 'Comfort',
  'component.climate.entity_component._.state_attributes.preset_mode.state.eco': 'Eco',
  'component.climate.entity_component._.state_attributes.preset_mode.state.home': 'Home',
  'component.climate.entity_component._.state_attributes.preset_mode.state.none': 'None',
  'component.climate.entity_component._.state_attributes.preset_mode.state.sleep': 'Sleep',
  'component.climate.entity_component._.state_attributes.swing_horizontal_mode.name': 'Horizontal swing mode',
  'component.climate.entity_component._.state_attributes.swing_horizontal_mode.state.off': 'Off',
  'component.climate.entity_component._.state_attributes.swing_horizontal_mode.state.on': 'On',
  'component.climate.entity_component._.state_attributes.swing_mode.name': 'Swing mode',
  'component.climate.entity_component._.state_attributes.swing_mode.state.both': 'Both',
  'component.climate.entity_component._.state_attributes.swing_mode.state.horizontal': 'Horizontal',
  'component.climate.entity_component._.state_attributes.swing_mode.state.off': 'Off',
  'component.climate.entity_component._.state_attributes.swing_mode.state.on': 'On',
  'component.climate.entity_component._.state_attributes.swing_mode.state.vertical': 'Vertical',
  'component.climate.entity_component._.state_attributes.target_temp_high.name': 'Upper target temperature',
  'component.climate.entity_component._.state_attributes.target_temp_low.name': 'Lower target temperature',
  'component.climate.entity_component._.state_attributes.temperature.name': 'Target temperature',
}

const TEMPERATURE_ATTRIBUTES = new Set([
  'temperature',
  'current_temperature',
  'target_temperature',
  'target_temp_temp',
  'target_temp_high',
  'target_temp_low',
  'target_temp_step',
  'min_temp',
  'max_temp',
])

const DOMAIN_ATTRIBUTES_UNITS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  climate: {
    humidity: '%',
    current_humidity: '%',
    target_humidity_low: '%',
    target_humidity_high: '%',
    target_humidity_step: '%',
    min_humidity: '%',
    max_humidity: '%',
  },
  cover: {
    current_position: '%',
    current_tilt_position: '%',
  },
  fan: {
    percentage: '%',
  },
  humidifier: {
    humidity: '%',
    current_humidity: '%',
    min_humidity: '%',
    max_humidity: '%',
    target_humidity_step: '%',
  },
  light: {
    color_temp: 'mired',
    max_mireds: 'mired',
    min_mireds: 'mired',
    color_temp_kelvin: 'K',
    min_color_temp_kelvin: 'K',
    max_color_temp_kelvin: 'K',
    brightness: '%',
  },
  sun: {
    azimuth: '°',
    elevation: '°',
  },
  valve: {
    current_position: '%',
  },
  sensor: {
    battery_level: '%',
  },
  media_player: {
    volume_level: '%',
  },
}

const DOMAIN_ATTRIBUTES_FORMATTERS: Readonly<
  Record<string, Readonly<Record<string, (value: number) => string>>>
> = {
  light: {
    brightness: (value) => Math.round((value / 255) * 100).toString(),
  },
  media_player: {
    volume_level: (value) => Math.round(value * 100).toString(),
  },
  input_datetime: {
    year: (value) => value.toString(),
  },
}

const SPACE_BEFORE_PERCENT_LANGS = new Set(['cs', 'de', 'fi', 'fr', 'sk', 'sv'])

const numberFormatCache = new Map<string, Intl.NumberFormat>()

function getNumberFormatter(language: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify([language, options])
  let formatter = numberFormatCache.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(language, options)
    numberFormatCache.set(key, formatter)
  }
  return formatter
}

export function blankBeforeUnit(unit: string, language: string): string {
  if (unit === '°') return ''
  if (unit === '%') return SPACE_BEFORE_PERCENT_LANGS.has(language.split('-')[0] ?? language) ? '\u00A0' : ''
  return '\u00A0'
}

export function formatNumber(
  num: string | number,
  language = 'en',
  options?: Intl.NumberFormatOptions,
): string {
  const numeric = Number(num)
  if (Number.isNaN(numeric)) return String(num)
  const resolved: Intl.NumberFormatOptions = { maximumFractionDigits: 2, ...options }
  if (
    typeof num === 'string' &&
    (!options || (options.minimumFractionDigits === undefined && options.maximumFractionDigits === undefined))
  ) {
    const digits = Math.min(num.includes('.') ? (num.split('.')[1]?.length ?? 0) : 0, 100)
    resolved.minimumFractionDigits = digits
    resolved.maximumFractionDigits = digits
  }
  return getNumberFormatter(language, resolved).format(numeric)
}

function fallbackAttributeName(attribute: string): string {
  const spaced = attribute
    .replace(/_/g, ' ')
    .replace(/\bid\b/g, 'ID')
    .replace(/\bip\b/g, 'IP')
    .replace(/\bmac\b/g, 'MAC')
    .replace(/\bgps\b/g, 'GPS')
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : spaced
}

/** Humanizes unbundled enum-like snake_case / kebab-case states when offline. */
function fallbackStateDisplay(raw: string): string {
  if (!raw || !Number.isNaN(Number(raw))) return raw
  if (/^\d{4}-\d{2}-\d{2}/.test(raw) || /^\d{2}:\d{2}/.test(raw)) return raw
  if (!/^[a-z0-9_-]+$/.test(raw)) return raw
  const spaced = raw.replace(/[_-]+/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function getIconFromRange(value: number, range: Record<string, string>): string | undefined {
  const thresholds = Object.keys(range)
    .map(Number)
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b)
  if (thresholds.length === 0 || value < thresholds[0]!) return undefined
  let picked = thresholds[0]!
  for (const t of thresholds) {
    if (value >= t) picked = t
    else break
  }
  return range[String(picked)]
}

function pickEntityIconFromEntry(
  entry: IconTranslationEntry | undefined,
  state: string | undefined,
): string | undefined {
  if (!entry) return undefined
  if (state !== undefined && entry.state?.[state]) return entry.state[state]
  if (state !== undefined && entry.range && !Number.isNaN(Number(state))) {
    return getIconFromRange(Number(state), entry.range) ?? entry.default
  }
  return entry.default
}

function pickIconFromEntry(
  entry: IconTranslationEntry | undefined,
  attribute: string,
  value: string | undefined,
): string | undefined {
  const attrIcons = entry?.state_attributes?.[attribute]
  if (!attrIcons) return undefined
  if (value !== undefined && attrIcons.state?.[value]) return attrIcons.state[value]
  if (value !== undefined && attrIcons.range && !Number.isNaN(Number(value))) {
    return getIconFromRange(Number(value), attrIcons.range) ?? attrIcons.default
  }
  return attrIcons.default
}

export type FormatContext = {
  language: string
  temperatureUnit: string
  unitSystem?: UnitSystem
  translations: Record<string, string>
  registryOf: Record<string, EntityRegistryInfo>
  icons: HassIcons
}

export type EntityFormatters = {
  language: string
  temperatureUnit: string
  unitSystem: UnitSystem
  localize: (key: string, placeholders?: Record<string, string | number>) => string
  formatNumber: (num: string | number, options?: Intl.NumberFormatOptions) => string
  blankBeforeUnit: (unit: string) => string
  formatEntityState: (stateObj: HassEntity, state?: string) => string
  formatEntityAttributeName: (stateObj: HassEntity, attribute: string) => string
  formatEntityAttributeValue: (stateObj: HassEntity, attribute: string, value?: unknown) => string
  /** Returns the raw `mdi:*` icon name for an entity state from registry or `frontend/get_icons`. */
  resolveEntityIconName: (stateObj: HassEntity, state?: string) => string | undefined
  /** Returns the raw `mdi:*` icon name from HA's `frontend/get_icons` resources, if present. */
  resolveAttributeIconName: (stateObj: HassEntity, attribute: string, value?: string) => string | undefined
}

export const DEFAULT_FORMAT_CONTEXT: FormatContext = {
  language: 'en',
  temperatureUnit: DEFAULT_UNIT_SYSTEM.temperature,
  unitSystem: DEFAULT_UNIT_SYSTEM,
  translations: {},
  registryOf: {},
  icons: { entity_component: {}, entity: {} },
}

export function createFormatters(ctx: FormatContext = DEFAULT_FORMAT_CONTEXT): EntityFormatters {
  const unitSystem: UnitSystem = ctx.unitSystem ?? {
    ...DEFAULT_UNIT_SYSTEM,
    temperature: ctx.temperatureUnit || DEFAULT_UNIT_SYSTEM.temperature,
  }

  const localize = (key: string, placeholders?: Record<string, string | number>): string => {
    const raw = ctx.translations[key] || FALLBACK_RESOURCES[key] || ''
    if (!raw || !placeholders) return raw
    return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in placeholders ? String(placeholders[name]) : match,
    )
  }

  const fmtNumber = (num: string | number, options?: Intl.NumberFormatOptions) =>
    formatNumber(num, ctx.language, options)

  const fmtBlankBeforeUnit = (unit: string) => blankBeforeUnit(unit, ctx.language)

  const formatEntityState = (stateObj: HassEntity, state?: string): string => {
    const s = state !== undefined ? state : stateObj.state
    if (s === 'unknown' || s === 'unavailable') {
      return localize(`state.default.${s}`) || s
    }
    const domain = domainOf(stateObj.entity_id)
    const dc = stateObj.attributes.device_class
    const entry = ctx.registryOf[stateObj.entity_id]

    const translated =
      (entry?.translation_key &&
        localize(`component.${entry.platform}.entity.${domain}.${entry.translation_key}.state.${s}`)) ||
      (dc && localize(`component.${domain}.entity_component.${dc}.state.${s}`)) ||
      localize(`component.${domain}.entity_component._.state.${s}`)
    if (translated) return translated

    if (domain === 'sensor' && !Number.isNaN(Number(s)) && s.trim() !== '') {
      const precision = entry?.display_precision
      const formatted =
        precision !== undefined && precision !== null
          ? fmtNumber(Number(s), { minimumFractionDigits: precision, maximumFractionDigits: precision })
          : fmtNumber(s)
      const unit = stateObj.attributes.unit_of_measurement
      return unit ? `${formatted}${fmtBlankBeforeUnit(unit)}${unit}` : formatted
    }

    return fallbackStateDisplay(s)
  }

  const formatEntityAttributeName = (stateObj: HassEntity, attribute: string): string => {
    const domain = domainOf(stateObj.entity_id)
    const dc = stateObj.attributes.device_class
    const entry = ctx.registryOf[stateObj.entity_id]
    return (
      (entry?.translation_key &&
        localize(
          `component.${entry.platform}.entity.${domain}.${entry.translation_key}.state_attributes.${attribute}.name`,
        )) ||
      (dc && localize(`component.${domain}.entity_component.${dc}.state_attributes.${attribute}.name`)) ||
      localize(`component.${domain}.entity_component._.state_attributes.${attribute}.name`) ||
      localize(`ui.components.attributes.names.${attribute}`) ||
      fallbackAttributeName(attribute)
    )
  }

  const formatEntityAttributeValue = (stateObj: HassEntity, attribute: string, value?: unknown): string => {
    const attrVal = value !== undefined ? value : stateObj.attributes[attribute]
    if (attrVal === null || attrVal === undefined) {
      return localize('state.default.unknown') || 'Unknown'
    }
    const domain = domainOf(stateObj.entity_id)
    if (typeof attrVal === 'number') {
      const customFormatter = DOMAIN_ATTRIBUTES_FORMATTERS[domain]?.[attribute]
      const formatted = customFormatter ? customFormatter(attrVal) : fmtNumber(attrVal)
      const unit = TEMPERATURE_ATTRIBUTES.has(attribute)
        ? ctx.temperatureUnit
        : DOMAIN_ATTRIBUTES_UNITS[domain]?.[attribute]
      if (unit) return `${formatted}${fmtBlankBeforeUnit(unit)}${unit}`
      return formatted
    }
    if (Array.isArray(attrVal)) {
      return attrVal.map((item) => formatEntityAttributeValue(stateObj, attribute, item)).join(', ')
    }
    if (typeof attrVal === 'object') {
      return JSON.stringify(attrVal)
    }
    const strVal = String(attrVal)
    const dc = stateObj.attributes.device_class
    const entry = ctx.registryOf[stateObj.entity_id]
    return (
      (entry?.translation_key &&
        localize(
          `component.${entry.platform}.entity.${domain}.${entry.translation_key}.state_attributes.${attribute}.state.${strVal}`,
        )) ||
      (dc && localize(`component.${domain}.entity_component.${dc}.state_attributes.${attribute}.state.${strVal}`)) ||
      localize(`component.${domain}.entity_component._.state_attributes.${attribute}.state.${strVal}`) ||
      strVal
    )
  }

  const resolveEntityIconName = (stateObj: HassEntity, state?: string): string | undefined => {
    const entry = ctx.registryOf[stateObj.entity_id]
    if (entry?.icon) return entry.icon
    if (typeof stateObj.attributes.icon === 'string' && stateObj.attributes.icon) {
      return stateObj.attributes.icon
    }
    const domain = domainOf(stateObj.entity_id)
    const dc = stateObj.attributes.device_class
    const compareState = state ?? stateObj.state

    if (entry?.translation_key && entry.platform) {
      const platEntry = ctx.icons.entity[entry.platform]?.[domain]?.[entry.translation_key]
      const icon = pickEntityIconFromEntry(platEntry, compareState)
      if (icon) return icon
    }
    const compDomain = ctx.icons.entity_component[domain]
    if (compDomain) {
      const compEntry = (dc ? compDomain[dc] : undefined) ?? compDomain._
      const icon = pickEntityIconFromEntry(compEntry, compareState)
      if (icon) return icon
    }
    return undefined
  }

  const resolveAttributeIconName = (
    stateObj: HassEntity,
    attribute: string,
    value?: string,
  ): string | undefined => {
    const domain = domainOf(stateObj.entity_id)
    const dc = stateObj.attributes.device_class
    const entry = ctx.registryOf[stateObj.entity_id]
    const rawVal = value ?? (stateObj.attributes[attribute] != null ? String(stateObj.attributes[attribute]) : undefined)
    if (entry?.translation_key && entry.platform) {
      const platEntry = ctx.icons.entity[entry.platform]?.[domain]?.[entry.translation_key]
      const icon = pickIconFromEntry(platEntry, attribute, rawVal)
      if (icon) return icon
    }
    const compDomain = ctx.icons.entity_component[domain]
    if (compDomain) {
      const compEntry = (dc ? compDomain[dc] : undefined) ?? compDomain._
      const icon = pickIconFromEntry(compEntry, attribute, rawVal)
      if (icon) return icon
    }
    return undefined
  }

  return {
    language: ctx.language,
    temperatureUnit: ctx.temperatureUnit,
    unitSystem,
    localize,
    formatNumber: fmtNumber,
    blankBeforeUnit: fmtBlankBeforeUnit,
    formatEntityState,
    formatEntityAttributeName,
    formatEntityAttributeValue,
    resolveEntityIconName,
    resolveAttributeIconName,
  }
}

export const defaultFormatters = createFormatters(DEFAULT_FORMAT_CONTEXT)

/** Subscribes to Home Assistant's live translations, unit system, registry and icons (falls back to English/°C offline). */
export function useEntityFormatters(): EntityFormatters {
  const language = useHass((s) => s.language)
  const temperatureUnit = useHass((s) => s.temperatureUnit)
  const unitSystem = useHass((s) => s.unitSystem)
  const translations = useHass((s) => s.translations)
  const registryOf = useHass((s) => s.registryOf)
  const icons = useHass((s) => s.icons)
  return useMemo(
    () => createFormatters({ language, temperatureUnit, unitSystem, translations, registryOf, icons }),
    [language, temperatureUnit, unitSystem, translations, registryOf, icons],
  )
}
