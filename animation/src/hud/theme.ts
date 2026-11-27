import { create } from 'zustand'

/**
 * The interface theme: light, dark, or following the system. It sets `dark` on <html> (the status
 * screens and Pascal's tokens) and `data-hud-theme` (the HUD's glass palette in styles.css). It
 * only changes the chrome, never the 3D scene's own look.
 */
export type ThemeChoice = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'pascal-hud:theme'
const systemDark = matchMedia('(prefers-color-scheme: dark)')

function readChoice(): ThemeChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  } catch {
    // Storage can be blocked in embeds; fall back to the system setting.
  }
  return 'system'
}

function apply(choice: ThemeChoice) {
  const dark = choice === 'dark' || (choice === 'system' && systemDark.matches)
  const root = document.documentElement
  root.classList.toggle('dark', dark)
  root.dataset.hudTheme = dark ? 'dark' : 'light'
  root.style.colorScheme = dark ? 'dark' : 'light'
}

export const useTheme = create<{ choice: ThemeChoice; setChoice: (choice: ThemeChoice) => void }>((set) => ({
  choice: readChoice(),
  setChoice: (choice) => {
    try {
      localStorage.setItem(STORAGE_KEY, choice)
    } catch {
      // Not persisted; still applied for this visit.
    }
    apply(choice)
    set({ choice })
  },
}))

/** Applies the saved choice now and follows the system while the choice is "system". */
export function startTheme(): () => void {
  apply(useTheme.getState().choice)
  const onSystemChange = () => {
    if (useTheme.getState().choice === 'system') apply('system')
  }
  systemDark.addEventListener('change', onSystemChange)
  return () => systemDark.removeEventListener('change', onSystemChange)
}
