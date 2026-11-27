import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { startTheme } from './hud/theme'
import './styles.css'

const stopTheme = startTheme()

const root = createRoot(document.getElementById('root')!)
root.render(<StrictMode><App /></StrictMode>)

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopTheme()
    root.unmount()
  })
}
