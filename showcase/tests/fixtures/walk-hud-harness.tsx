import { createWalkthroughInput, useViewer } from '@pascal-app/viewer'
import { type FirstPersonHudState, useFirstPersonHud } from '@pascal-app/viewer/ui'
import { createRoot } from 'react-dom/client'
import '../../src/styles.css'
import { WalkHud } from '../../src/showcase/WalkHud'

type Hud = Partial<Pick<FirstPersonHudState, 'interact' | 'seenInteract' | 'shuttersInView' | 'canClose'>>

declare global {
  interface Window {
    walk: {
      setHud: (hud: Hud) => void
      setTouch: (touch: boolean) => void
      requests: Record<'interact' | 'jump' | 'shutters' | 'close', number>
      keys: string[]
    }
  }
}

// Count what the HUD asks of the package's input channel (one shared object per page).
const input = createWalkthroughInput()
const requests = { interact: 0, jump: 0, shutters: 0, close: 0 }
input.requestInteract = () => { requests.interact++ }
input.requestJump = () => { requests.jump++ }
input.requestShutters = () => { requests.shutters++ }
input.requestClose = () => { requests.close++ }
const keys: string[] = []
document.addEventListener('keydown', (event) => keys.push(event.code))

window.walk = {
  setHud: (hud) => useFirstPersonHud.getState().setHud(hud),
  setTouch: (touch) => useViewer.getState().setWalkthroughInputMode(touch ? 'touch' : 'desktop'),
  requests,
  keys,
}
createRoot(document.getElementById('root')!).render(<div className="sc-chrome"><WalkHud /></div>)
