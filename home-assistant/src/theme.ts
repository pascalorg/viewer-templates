/**
 * Light or dark interface. The system setting decides until the visitor flips the switch; their
 * choice is then remembered in this browser. The viewer's own header and controls bar stay dark
 * (the package draws them so); the page and the guided tour follow this.
 */
const KEY = 'pascal-viewer-theme'
const system = () => matchMedia('(prefers-color-scheme: dark)').matches

export function chosenTheme(): 'light' | 'dark' | null {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

export function isDark() {
  const chosen = chosenTheme()
  return chosen ? chosen === 'dark' : system()
}

/** The interface's style: frosted glass panels over the plan (the default), or solid ones. */
export type UiStyle = 'solid' | 'glass'
const STYLE_KEY = 'pascal-viewer-ui-style'

export function uiStyle(): UiStyle {
  try {
    return localStorage.getItem(STYLE_KEY) === 'solid' ? 'solid' : 'glass'
  } catch {
    return 'glass'
  }
}

export function applyTheme() {
  document.documentElement.classList.toggle('dark', isDark())
  document.documentElement.dataset.uiStyle = uiStyle()
}

const EDGES_KEY = 'pascal-viewer-plan-edges'

/** Whether the plan's wireframe draws its edge lines; off by default, only the frosted faces show. */
export function planEdges(): boolean {
  try {
    return localStorage.getItem(EDGES_KEY) === 'on'
  } catch {
    return false
  }
}

export function choosePlanEdges(on: boolean) {
  try {
    localStorage.setItem(EDGES_KEY, on ? 'on' : 'off')
  } catch {
    // Not remembered; the choice still holds for this visit.
  }
  dispatchEvent(new Event('pascal-theme'))
}

export function chooseUiStyle(style: UiStyle) {
  try {
    localStorage.setItem(STYLE_KEY, style)
  } catch {
    // Not remembered; the choice still holds for this visit.
  }
  applyTheme()
  dispatchEvent(new Event('pascal-theme'))
}

export function chooseTheme(dark: boolean) {
  try {
    localStorage.setItem(KEY, dark ? 'dark' : 'light')
  } catch {
    // Not remembered; the switch still works for this visit.
  }
  applyTheme()
  dispatchEvent(new Event('pascal-theme'))
}
