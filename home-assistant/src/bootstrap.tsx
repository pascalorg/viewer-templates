import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyTheme } from './theme'
import './styles.css'

const colorScheme = matchMedia('(prefers-color-scheme: dark)')
// The system setting, unless the visitor chose light or dark with the switch (`theme.ts`).
const syncTheme = applyTheme
syncTheme()
colorScheme.addEventListener('change', syncTheme)

const root = createRoot(document.getElementById('root')!)
root.render(<StrictMode><App /></StrictMode>)

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    colorScheme.removeEventListener('change', syncTheme)
    root.unmount()
  })
}
