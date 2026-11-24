/** Whether the settings panel is open, remembered for the tab (one viewer per page). */
const KEY = 'pascal:settings-panel'

export function readPanelOpen(): boolean | null {
  try {
    const value = sessionStorage.getItem(KEY)
    return value === 'open' ? true : value === 'closed' ? false : null
  } catch {
    return null
  }
}

export function rememberPanelOpen(open: boolean): void {
  try {
    sessionStorage.setItem(KEY, open ? 'open' : 'closed')
  } catch {
    // Storage denied: the panel opens on arrival in Customize mode, as the first time.
  }
}
