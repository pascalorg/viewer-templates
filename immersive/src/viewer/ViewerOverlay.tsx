import { useLocale, usePascalI18n } from '@pascal-app/core'
import { useViewer, type WalkthroughMovement } from '@pascal-app/viewer'
import type { ViewerSource, ViewerStageMode } from '@pascal-app/viewer/ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { arrangeTour, type SavedTour } from '../settings/opening'
import { tourFloors } from '../tour/stops'
import { TourIntro, TourTitleCard } from '../tour/TourTitleCard'
import { ThemeSwitch, TourControls, TourPanel } from '../tour/TourUi'
import { useGuidedTour } from '../tour/useGuidedTour'
import { useArStore } from './ar/store'
import { ArPopover } from './chrome/ArPopover'
import { BottomSheet } from './chrome/BottomSheet'
import { BrandHeader } from './chrome/BrandHeader'
import { CommandBar, type CommandPopover } from './chrome/CommandBar'
import { ExplorePanel, useSceneLevels } from './chrome/ExplorePanel'
import { OnboardingHint, readOnboardingDismissed, saveOnboardingDismissed } from './chrome/OnboardingHint'
import { SelectionCard } from './chrome/SelectionCard'
import { ShortcutsSheet } from './chrome/ShortcutsSheet'
import { useSyncAmbientOcclusion } from './chrome/useAmbientOcclusion'
import { useImmersive } from './chrome/useImmersive'
import { useIsCompact } from './chrome/useIsCompact'
import { useViewerShortcuts } from './chrome/useViewerShortcuts'
import { MeasureHud } from './measure/MeasureHud'
import { useMeasureStore } from './measure/store'
import { useVrStore } from './vr/store'

// A press on the active camera's button leaves it; the other button switches
// straight to that camera.
function toggleWalkthrough(movement: WalkthroughMovement) {
  const viewer = useViewer.getState()
  if (viewer.walkthroughMode && viewer.walkthroughMovement === movement) {
    viewer.setWalkthroughMode(false)
    return
  }
  viewer.setWalkthroughMovement(movement)
  viewer.setWalkthroughMode(true)
}

/**
 * Viewer chrome over the 3D/2D stage: left Explore panel (with isometric FloorStack and live
 * MiniPlan), contextual SelectionCard, grouped bottom CommandBar (with SunArc Light popover),
 * illustrated OnboardingHint, ShortcutsSheet, and 4s desktop immersive fade. During the guided
 * tour or walkthrough, the chrome steps aside so the tour or walkthrough HUD owns the screen.
 */
export function ViewerOverlay({
  projectName,
  ownerName,
  glbActive,
  glbHasScans,
  glbHasGuides,
  hideHeader,
  hideBottomBar,
  embed,
  arAutoOpen = false,
  autostartTour = false,
  tourSettings,
  stageMode,
  hasFloorplan,
  onStageModeChange,
  source,
}: {
  projectName: string | null
  /** Shown under the project name; null in embeds. */
  ownerName: string | null
  /** A ready bake is on screen: hides controls a GLB can't honour (wall modes). */
  glbActive: boolean
  /** Scans/guides rebuilt from the graph over the bake, so their toggles show. */
  glbHasScans: boolean
  glbHasGuides: boolean
  hideHeader: boolean
  hideBottomBar: boolean
  embed: boolean
  /** Opened from a `?ar=1` QR scan: open the AR card automatically once the scene is ready. */
  arAutoOpen?: boolean
  /** Viewer settings asked for the guided tour on arrival and the scene is on screen: start it once. */
  autostartTour?: boolean
  /** Viewer settings' tour route (saved, or a manager's draft): room order and skipped rooms. */
  tourSettings?: SavedTour
  stageMode: ViewerStageMode
  hasFloorplan: boolean
  onStageModeChange: (mode: ViewerStageMode) => void
  /** The scene the chrome navigates: the published graph over a bake, or the live store. */
  source: ViewerSource
}) {
  const walkthroughMode = useViewer((s) => s.walkthroughMode)
  const walkthroughMovement = useViewer((s) => s.walkthroughMovement)
  const vrSupport = useVrStore((s) => s.support)
  const vrStatus = useVrStore((s) => s.status)
  const vrActive = vrStatus === 'active'
  const arPlatform = useArStore((s) => s.platform)
  const arStatus = useArStore((s) => s.status)
  const arSceneReady = useArStore((s) => s.sceneReady)
  const arActive = arStatus === 'active'
  const measureActive = useMeasureStore((s) => s.active)
  const hasSelection = useViewer(
    (s) => Boolean(s.selection.zoneId || s.focusedUnitId || s.selection.selectedIds.length > 0),
  )

  const i18n = usePascalI18n()
  const locale = useLocale()
  const floors = useMemo(() => arrangeTour(tourFloors(source.nodes, i18n, locale), tourSettings),
    [source.nodes, i18n, locale, tourSettings])
  const stops = useMemo(() => floors.flatMap((floor) => floor.stops), [floors])
  const tour = useGuidedTour(source, stops)
  const levels = useSceneLevels(source)
  const levelIds = useMemo(() => levels.map((lvl) => lvl.id), [levels])
  const compact = useIsCompact()
  useSyncAmbientOcclusion()

  const [exploreOpen, setExploreOpen] = useState(true)
  const [mobileExploreOpen, setMobileExploreOpen] = useState(false)
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)
  const [mobileArOpen, setMobileArOpen] = useState(false)
  const [activePopover, setActivePopover] = useState<CommandPopover>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [onboardingDismissed, setOnboardingDismissed] = useState(readOnboardingDismissed)
  const autoOpenedArRef = useRef(false)

  // Crossing the 768px breakpoint cleanly closes any open desktop popovers or mobile sheets.
  useEffect(() => {
    setActivePopover(null)
    setMobileExploreOpen(false)
    setMobileMoreOpen(false)
    setMobileArOpen(false)
    setShortcutsOpen(false)
  }, [compact])

  const dismissOnboarding = useCallback(() => {
    setOnboardingDismissed(true)
    saveOnboardingDismissed()
  }, [])

  // `?ar=1` from a QR scan opens the AR card once on phones/tablets as soon as the scene is ready.
  useEffect(() => {
    if (!arAutoOpen || autoOpenedArRef.current || !arSceneReady) return
    if (arPlatform === 'unknown' || arPlatform === 'qr') return
    autoOpenedArRef.current = true
    dismissOnboarding()
    setMobileExploreOpen(false)
    setMobileMoreOpen(false)
    setShortcutsOpen(false)
    if (compact) setMobileArOpen(true)
    else setActivePopover('ar')
  }, [arAutoOpen, arPlatform, arSceneReady, compact, dismissOnboarding])

  const startTour = useCallback(() => {
    dismissOnboarding()
    setActivePopover(null)
    setMobileExploreOpen(false)
    setMobileMoreOpen(false)
    setMobileArOpen(false)
    setShortcutsOpen(false)
    useMeasureStore.getState().exit()
    tour.start()
  }, [dismissOnboarding, tour])

  const autostartedRef = useRef(false)
  useEffect(() => {
    if (!autostartTour || autostartedRef.current || stops.length === 0) return
    autostartedRef.current = true
    startTour()
  }, [autostartTour, startTour, stops.length])

  const startVr = useCallback(() => {
    dismissOnboarding()
    setActivePopover(null)
    setMobileExploreOpen(false)
    setMobileMoreOpen(false)
    setMobileArOpen(false)
    setShortcutsOpen(false)
    useMeasureStore.getState().exit()
    if (tour.active) tour.stop()
    if (stageMode !== '3d') onStageModeChange('3d')
    useVrStore.getState().enterVr()
  }, [dismissOnboarding, onStageModeChange, stageMode, tour])

  const startAr = useCallback(() => {
    dismissOnboarding()
    setActivePopover(null)
    setMobileExploreOpen(false)
    setMobileMoreOpen(false)
    setShortcutsOpen(false)
    useMeasureStore.getState().exit()
    if (tour.active) tour.stop()
    if (compact) setMobileArOpen(true)
    else setActivePopover('ar')
  }, [compact, dismissOnboarding, tour])

  const toggleMeasure = useCallback(() => {
    const store = useMeasureStore.getState()
    if (store.active) {
      store.exit()
      return
    }
    dismissOnboarding()
    setActivePopover(null)
    setMobileExploreOpen(false)
    setMobileMoreOpen(false)
    setMobileArOpen(false)
    setShortcutsOpen(false)
    const viewer = useViewer.getState()
    viewer.setHoveredId(null)
    viewer.setFocusedUnit(null)
    if (viewer.selection.zoneId || viewer.selection.selectedIds.length > 0) {
      viewer.setSelection({ zoneId: null, selectedIds: [] })
    }
    store.enter()
  }, [dismissOnboarding])

  const handleEscape = useCallback(() => {
    if (shortcutsOpen) {
      setShortcutsOpen(false)
      return true
    }
    if (activePopover !== null) {
      setActivePopover(null)
      return true
    }
    if (mobileArOpen) {
      setMobileArOpen(false)
      return true
    }
    if (mobileExploreOpen) {
      setMobileExploreOpen(false)
      return true
    }
    if (mobileMoreOpen) {
      setMobileMoreOpen(false)
      return true
    }
    if (!onboardingDismissed) {
      dismissOnboarding()
      return true
    }
    const measure = useMeasureStore.getState()
    if (measure.active) {
      if (!measure.cancelPending()) measure.exit()
      return true
    }
    return false
  }, [shortcutsOpen, activePopover, mobileArOpen, mobileExploreOpen, mobileMoreOpen, onboardingDismissed, dismissOnboarding])

  useViewerShortcuts({
    disabled: tour.active || walkthroughMode || vrActive || arActive,
    compact,
    hasFloorplan,
    levelIds,
    source,
    onStartTour: startTour,
    onWalkthroughToggle: () => toggleWalkthrough('walk'),
    onDroneToggle: () => toggleWalkthrough('drone'),
    onMeasureToggle: toggleMeasure,
    onStageModeChange,
    onToggleExplore: () => (compact ? setMobileExploreOpen((v) => !v) : setExploreOpen((v) => !v)),
    onToggleShortcuts: () => setShortcutsOpen((v) => !v),
    onEscape: handleEscape,
  })

  const showNormalChrome = !tour.active && !walkthroughMode && !vrActive && !arActive
  // Production's lockup, top left, on wide screens.
  const showBrand = !compact && !hideHeader
  const anyMobileSheetOpen = compact && (mobileExploreOpen || mobileMoreOpen || mobileArOpen)
  const immersive = useImmersive({
    blocked:
      !showNormalChrome ||
      compact ||
      activePopover !== null ||
      shortcutsOpen ||
      mobileExploreOpen ||
      mobileMoreOpen ||
      mobileArOpen ||
      measureActive,
  })

  return (
    // Keep z-index `auto` on this wrapper so sheets (`z-50`) and modals (`z-[60]`) participate in
    // `<main>`'s root stacking context and sit above `ViewerStage`'s `z-30` compass host.
    <div className="pointer-events-none absolute inset-0" data-immersive={immersive ? 'true' : undefined}>
      {showNormalChrome ? (
        <>
          {showBrand ? <BrandHeader levels={levels} ownerName={ownerName} projectName={projectName} source={source} /> : null}

          {!hideHeader ? (
            <ExplorePanel
              compact={compact}
              embed={embed}
              levels={levels}
              mobileOpen={mobileExploreOpen}
              onMobileOpenChange={setMobileExploreOpen}
              onOpenChange={setExploreOpen}
              open={exploreOpen}
              ownerName={ownerName}
              projectName={projectName}
              source={source}
            />
          ) : null}

          <SelectionCard belowBrand={showBrand} compact={compact} hidden={anyMobileSheetOpen || measureActive} source={source} tour={tour} />

          <OnboardingHint
            compact={compact}
            onDismiss={dismissOnboarding}
            visible={!embed && !hideBottomBar && !onboardingDismissed && !hasSelection && !anyMobileSheetOpen && stageMode !== '2d' && !measureActive}
          />

          {!hideBottomBar && measureActive ? <MeasureHud compact={compact} /> : null}

          {!hideBottomBar ? (
            <CommandBar
              activePopover={activePopover}
              compact={compact}
              droneActive={walkthroughMode && walkthroughMovement === 'drone'}
              glbActive={glbActive}
              glbHasGuides={glbHasGuides}
              glbHasScans={glbHasScans}
              hasFloorplan={hasFloorplan}
              measureActive={measureActive}
              mobileMoreOpen={mobileMoreOpen}
              onDroneToggle={() => toggleWalkthrough('drone')}
              onEnterAr={startAr}
              onEnterVr={startVr}
              onMeasureToggle={toggleMeasure}
              onOpenExploreMobile={() => {
                setMobileMoreOpen(false)
                setMobileExploreOpen(true)
              }}
              onOpenShortcuts={() => setShortcutsOpen(true)}
              onStageModeChange={onStageModeChange}
              onWalkthroughToggle={() => toggleWalkthrough('walk')}
              setActivePopover={setActivePopover}
              setMobileMoreOpen={setMobileMoreOpen}
              source={source}
              stageMode={stageMode}
              tour={{ ...tour, start: startTour }}
              vrBusy={vrStatus === 'requesting'}
              vrSupport={vrSupport}
              walkthroughActive={walkthroughMode && walkthroughMovement === 'walk'}
            />
          ) : null}

          <BottomSheet
            eyebrow="Augmented reality"
            onClose={() => setMobileArOpen(false)}
            open={compact && mobileArOpen}
            title="AR mode"
          >
            <div className="pb-2">
              <ArPopover onClose={() => setMobileArOpen(false)} showHeader={false} />
            </div>
          </BottomSheet>

          <ShortcutsSheet onClose={() => setShortcutsOpen(false)} open={shortcutsOpen} />
        </>
      ) : null}

      {/* During the guided tour keep only the minimal project card, ThemeSwitch, and tour chrome. */}
      {tour.active && !hideHeader ? (
        <div className="pointer-events-none absolute top-4 left-4 z-20" data-viewer-header="">
          <div className="ui-glass corner-smooth relative pointer-events-auto max-w-[min(20rem,calc(100vw-2rem))] rounded-[20px] px-4 py-3 text-foreground">
            <p className="ui-eyebrow ui-eyebrow-rule">Project</p>
            <p className="mt-1 truncate font-light text-2xl leading-tight tracking-[-0.03em]">
              {projectName || 'Untitled'}
            </p>
            {ownerName ? (
              <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">{ownerName}</span>
            ) : null}
          </div>
        </div>
      ) : null}

      {tour.active && !hideBottomBar ? (
        <>
          {/* With the 2D plan showing (split or 2D), its zoom / fit pill owns the bottom-right
              corner, so the switch stays lifted above it on wide screens too. */}
          <div className={`pointer-events-none absolute right-3 bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.75rem)] z-20 sm:right-6 sm:bottom-24 ${stageMode === '3d' ? 'lg:bottom-6' : 'lg:right-4 lg:bottom-20'}`}>
            <ThemeSwitch compact />
          </div>
          <TourIntro projectName={projectName} roomCount={stops.length} visible={tour.intro} />
          <TourTitleCard tour={tour} />
          <TourControls tour={tour} />
          <TourPanel floors={floors} tour={tour} />
        </>
      ) : null}
    </div>
  )
}
