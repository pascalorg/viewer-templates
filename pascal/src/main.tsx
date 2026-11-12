import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { captureHandoffCallback } from './pascal/handoff'
import './styles.css'

captureHandoffCallback()

const colorScheme = matchMedia('(prefers-color-scheme: dark)')
const syncTheme = () => document.documentElement.classList.toggle('dark', colorScheme.matches)
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
