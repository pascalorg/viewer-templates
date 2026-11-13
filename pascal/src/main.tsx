import { captureHandoffCallback } from './pascal/handoff'

captureHandoffCallback()

// App imports may execute code that observes the URL. Scrub before loading them.
void import('./bootstrap')
