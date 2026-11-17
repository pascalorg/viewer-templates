import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

// The showcase is dark, like the /next page: the viewer's own UI uses its dark theme too.
document.documentElement.classList.add('dark')

const root = createRoot(document.getElementById('root')!)
root.render(<StrictMode><App /></StrictMode>)

if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
