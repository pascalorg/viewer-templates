import { captureHassCallback } from './home/hass/callback'
import { captureHandoffCallback } from './pascal/handoff'

// Home Assistant's sign-in first: its code and state would otherwise read as Pascal's.
captureHassCallback()
captureHandoffCallback()

// App imports may execute code that observes the URL. Scrub before loading them.
void import('./bootstrap')
