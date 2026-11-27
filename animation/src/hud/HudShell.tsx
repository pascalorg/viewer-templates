import { TooltipProvider, type ViewerSource, type ViewerStageMode } from '@pascal-app/viewer/ui'
import { useCallback, useState } from 'react'
import { useAnimationLifecycle } from '../animation/AnimationsTab'
import { AnimationStudio } from './AnimationStudio'
import { Inspector, type InspectorTabId } from './Inspector'
import { ModeDock } from './ModeDock'
import { NavigatorRail } from './NavigatorRail'
import { RenderDialog } from './RenderDialog'

const RAIL_STORAGE_KEY = 'pascal-hud:rail-collapsed'
const TAB_STORAGE_KEY = 'pascal-hud:inspector-tab'

function readSessionFlag(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function readSessionTab(): InspectorTabId {
  try {
    const raw = sessionStorage.getItem(TAB_STORAGE_KEY)
    if (raw === 'scene' || raw === 'look' || raw === 'light') return raw
  } catch {
    // Ignore storage access failures in restricted iframes.
  }
  return 'scene'
}

export type HudShellProps = {
  projectName: string | null
  ownerName: string | null
  glbActive: boolean
  glbHasScans: boolean
  glbHasGuides: boolean
  hideHeader: boolean
  hideBottomBar: boolean
  source: ViewerSource
  stageMode: ViewerStageMode
  onStageModeChange: (mode: ViewerStageMode) => void
  hasFloorplan: boolean
  embed: boolean
  ready: boolean
}

/** Composes the custom Light & Airy HUD (NavigatorRail, ModeDock, Inspector; no top breadcrumb pill) over the 3D/2D stage. */
export function HudShell({
  projectName,
  ownerName,
  glbActive,
  glbHasScans,
  glbHasGuides,
  hideHeader,
  hideBottomBar,
  source,
  stageMode,
  onStageModeChange,
  hasFloorplan,
  embed,
  ready,
}: HudShellProps) {
  useAnimationLifecycle(ready)

  const [railCollapsed, setRailCollapsed] = useState(() => readSessionFlag(RAIL_STORAGE_KEY))
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [inspectorTab, setInspectorTab] = useState<InspectorTabId>(() => readSessionTab())
  const [animationsOpen, setAnimationsOpen] = useState(false)

  const toggleRailCollapsed = useCallback(() => {
    setRailCollapsed((prev) => {
      const next = !prev
      try {
        sessionStorage.setItem(RAIL_STORAGE_KEY, next ? '1' : '0')
      } catch {
        // Ignore storage restrictions.
      }
      return next
    })
  }, [])

  const handleTabChange = useCallback((next: InspectorTabId) => {
    setInspectorTab(next)
    try {
      sessionStorage.setItem(TAB_STORAGE_KEY, next)
    } catch {
      // Ignore storage restrictions.
    }
  }, [])

  const handleOpenInspector = useCallback((next: boolean) => {
    if (next && typeof window !== 'undefined' && window.innerWidth >= 768 && window.innerWidth < 1024) {
      setRailCollapsed(true)
    }
    // Settings and Animations share the right edge: one at a time.
    if (next) setAnimationsOpen(false)
    setInspectorOpen(next)
  }, [])

  const handleOpenAnimate = useCallback(() => {
    setAnimationsOpen((prev) => {
      const next = !prev
      if (next) setInspectorOpen(false)
      return next
    })
  }, [])

  return (
    <TooltipProvider delayDuration={180}>
      {!hideHeader && (
        <NavigatorRail
          collapsed={railCollapsed}
          embed={embed}
          onToggleCollapsed={toggleRailCollapsed}
          ownerName={ownerName}
          projectName={projectName}
          source={source}
        />
      )}

      <ModeDock
        animateOpen={animationsOpen}
        hasFloorplan={hasFloorplan}
        onOpenAnimate={handleOpenAnimate}
        onStageModeChange={onStageModeChange}
        canRender={ready}
        showModes={!hideBottomBar && stageMode === '3d'}
        stageMode={stageMode}
      />

      <Inspector
        glbActive={glbActive}
        glbHasGuides={glbHasGuides}
        glbHasScans={glbHasScans}
        onOpenChange={handleOpenInspector}
        onTabChange={handleTabChange}
        open={inspectorOpen}
        tab={inspectorTab}
      />

      {stageMode !== '2d' && (
        <AnimationStudio
          onOpenChange={setAnimationsOpen}
          open={animationsOpen}
          ready={ready}
        />
      )}

      {stageMode === '3d' && <RenderDialog projectName={projectName} ready={ready} />}
    </TooltipProvider>
  )
}
