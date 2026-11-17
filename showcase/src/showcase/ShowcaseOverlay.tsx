import type { AnyNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useAudioSettings } from '@pascal-app/viewer/sfx'
import { type ViewerSource, WalkthroughTouchControls } from '@pascal-app/viewer/ui'
import type { Object3D } from 'three'
import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { features } from '../features'
import { createFrameCoalescer } from './coalesce'
import { CutSlider, type CutAxis, type CutState } from './CutSlider'
import { Dial, type DialLayer } from './Dial'
import { DiscoveryOverlay } from './discovery/DiscoveryOverlay'
import { useDiscovery } from './discovery/state'
import { familyLabel } from './families'
import { InteractionHelp } from './InteractionHelp'
import { IntroSlot } from './IntroSlot'
import { MobileControls } from './MobileControls'
import { availableModes, modeOf, moodOf, positionOf, sliderOf, type ModeId, type MoodId } from './modes'
import { useChromeSounds } from './sounds'
import { WalkHud } from './WalkHud'
import { glideToMood, moodMinutes, useGlideTarget } from './time'
import { trackPointerType, walkingByTouch } from './touch'
import { Utilities } from './TopBar'
import { useIntro } from './useIntro'
import {
  applyDefaultView, applyMode, axisRange, frameSettled, modelBounds, setCutAxis,
  setCutFlipped, setXrayFamily, type SceneContext,
} from './viewer-actions'

/** The layout the /next page uses: a dial on wide screens, a bottom bar on portrait phones. */
function useLayout() {
  const read = () => ({
    compact: matchMedia('(max-width: 760px), (pointer: coarse)').matches,
    phonePortrait: matchMedia('(max-width: 600px) and (orientation: portrait)').matches,
    coarsePointer: matchMedia('(pointer: coarse)').matches,
  })
  const [layout, setLayout] = useState(read)
  useEffect(() => {
    const update = () => setLayout((previous) => {
      const next = read()
      return next.compact === previous.compact && next.phonePortrait === previous.phonePortrait && next.coarsePointer === previous.coarsePointer
        ? previous : next
    })
    addEventListener('resize', update)
    return () => removeEventListener('resize', update)
  }, [])
  return layout
}

function useFullscreen() {
  const [fullscreen, setFullscreen] = useState(() => !!document.fullscreenElement)
  useEffect(() => {
    const change = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', change)
    return () => document.removeEventListener('fullscreenchange', change)
  }, [])
  const toggle = document.fullscreenEnabled ? () => {
    const request = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()
    request.catch(() => {})
  } : undefined
  return { fullscreen, toggle }
}

/**
 * The showcase chrome over the scene: sound and full screen, the dial (or the phone's bottom bar)
 * and help. Every control reads and writes the public viewer store.
 */
export function ShowcaseOverlay({ levelCount, nodes, families, source, bakedObjects, introAllowed, hideControls }: {
  levelCount: number
  /** The published graph. */
  nodes: Readonly<Record<string, AnyNode>>
  /** The X-ray families in the published graph, in display order (`sceneFamilies`). */
  families: readonly string[]
  /** What Reset view frames: the published graph over a bake, or the live scene. */
  source: ViewerSource
  /** The bake's objects by Pascal id, for the model's bounds; omitted for a live scene. */
  bakedObjects?: ReadonlyMap<string, Object3D>
  /** False when the page opens on a given camera (`?camera=`): no intro over it. */
  introAllowed: boolean
  hideControls: boolean
}) {
  const { compact, phonePortrait, coarsePointer } = useLayout()
  const { fullscreen, toggle: toggleFullscreen } = useFullscreen()
  const [chromeElement, setChromeElement] = useState<HTMLDivElement | null>(null)
  const [menu, setMenu] = useState<'help' | 'lighting' | null>(null)
  const muted = useAudioSettings((state) => state.muted)
  const modes = useMemo(() => availableModes(features, { coarsePointer, familyCount: families.length }), [coarsePointer, families])
  const context = useMemo<SceneContext>(() => ({ nodes, source, bakedObjects, families }), [nodes, source, bakedObjects, families])
  const layers = useMemo<DialLayer[]>(() => families.map((id) => ({ id, label: familyLabel(id) })), [families])
  const view = useViewer(useShallow(({ levelMode, walkthroughMode, walkthroughMovement, walkthroughInputMode, sectionEnabled, xrayFamily, timeOfDay, timeOfDayMinutes }) =>
    ({ levelMode, walkthroughMode, walkthroughMovement, walkthroughInputMode, sectionEnabled, xrayFamily, timeOfDay, timeOfDayMinutes })))
  const plane = useViewer(useShallow(({ sectionAxis, sectionPosition, sectionFlipped }) => ({ sectionAxis, sectionPosition, sectionFlipped })))
  const mode = modeOf(view)
  // While the sky glides, the dial already shows where it is going.
  const glideTarget = useGlideTarget()
  const sky = moodOf(view, moodMinutes)
  const mood = glideTarget ?? sky
  const intro = useIntro({ enabled: features.intro && introAllowed, frameOnArrival: introAllowed, levelCount, context })
  const cut = useCutControls(context, plane, features.cutView && mode === 'cut')

  // Discovery waits for the intro to hand the scene over.
  useEffect(() => useDiscovery.getState().setBlocked(intro.playing), [intro.playing])

  // Walking by touch follows the visitor's real input; a walk that ends hands a mouse-and-keyboard
  // device back to desktop input.
  useEffect(() => trackPointerType(), [])
  useEffect(() => {
    if (!view.walkthroughMode && view.walkthroughInputMode === 'touch' && !walkingByTouch()) {
      useViewer.getState().setWalkthroughInputMode('desktop')
    }
  }, [view.walkthroughMode, view.walkthroughInputMode])

  // The lighting disclosure closes on a press elsewhere or Escape; the help dialog handles its own.
  useEffect(() => {
    if (menu !== 'lighting') return
    const dismiss = (event: PointerEvent) => {
      if (!(event.target as Element).closest('[data-disclosure="lighting"]')) setMenu(null)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setMenu(null)
    }
    document.addEventListener('pointerdown', dismiss)
    addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      removeEventListener('keydown', escape, true)
    }
  }, [menu])

  const chooseMode = (next: ModeId) => {
    if (next === mode) return
    setMenu(null)
    applyMode(next, context)
  }
  const chooseMood = (next: MoodId) => {
    glideToMood(next)
  }
  const reset = () => {
    setMenu(null)
    applyDefaultView(levelCount, context)
    frameSettled(context, levelCount)
  }
  const toggleSound = () => {
    useAudioSettings.getState().setMuted(!muted)
  }

  const walking = mode === 'walkthrough'
  // /next's interface sounds on every control (`sounds.ts`).
  useChromeSounds(chromeElement)
  const help = <InteractionHelp mobile={phonePortrait} onOpenChange={(open) => setMenu(open ? 'help' : null)} open={menu === 'help'}
    touchWalk={features.touchWalk} walking={walking} />
  // Walking keeps the chrome as /next does (the dial, the top bar); by touch the thumbs own the
  // screen and only the walk HUD (and help) show.
  const touchWalking = walking && view.walkthroughInputMode === 'touch'
  const interactive = !intro.playing && !touchWalking

  return (
    <div className="sc-chrome" ref={setChromeElement} data-compact={compact} data-intro={intro.playing} data-layout={phonePortrait ? 'bottom' : 'dial'}
      data-level-mode={view.levelMode} data-menu={menu ?? ''} data-mode={mode ?? ''} data-mood={mood ?? ''} data-sky={sky ?? ''}
      data-walk-input={view.walkthroughInputMode} data-xray={view.xrayFamily ?? 'off'}
      data-section={view.sectionEnabled ? `${plane.sectionAxis}:${plane.sectionPosition.toFixed(2)}${plane.sectionFlipped ? ':flipped' : ''}` : 'off'}
      data-time-of-day={view.timeOfDayMinutes === null ? view.timeOfDay : `minutes:${Math.round(view.timeOfDayMinutes)}`}>
      <DiscoveryOverlay ink={mood === 'day' ? 'light' : 'default'} />
      {!touchWalking && (
        <Utilities fullscreen={fullscreen} onFullscreen={interactive ? toggleFullscreen : undefined} onSound={toggleSound} soundOn={!muted} />
      )}
      {features.touchWalk && <WalkthroughTouchControls className="sc-touch-walk" />}
      {walking && !hideControls && <WalkHud />}
      {touchWalking && !hideControls && <div className="sc-walk-help">{help}</div>}
      {intro.playing && <IntroSlot onDone={intro.skip} />}
      {interactive && !hideControls && cut && (!phonePortrait || menu !== 'lighting') && (
        <CutSlider cut={cut.state} horizontal={phonePortrait} onAxisChange={cut.setAxis} onFlipChange={cut.setFlipped}
          onPositionChange={cut.setPosition} readout={cut.readout} />
      )}
      {interactive && !hideControls && (phonePortrait
        ? <MobileControls help={help} layers={layers} layersOpen={mode === 'xray'} lightingOpen={menu === 'lighting'} mode={mode} modes={modes}
          mood={mood} onLayer={setXrayFamily} onLighting={() => setMenu((value) => (value === 'lighting' ? null : 'lighting'))}
          onMode={chooseMode} onMood={chooseMood} onReset={reset} pinned={view.xrayFamily} />
        : <Dial compact={compact} help={help} layers={layers} layersOpen={mode === 'xray'} mode={mode} modes={modes} mood={mood}
          onLayer={setXrayFamily} onMode={chooseMode} onMood={chooseMood} onReset={reset} pinned={view.xrayFamily} ready />)}
    </div>
  )
}

/**
 * The Cut view's controls, over the store: the slider's 0..1 spans the model's bounds on the
 * current axis (with a small margin), and scrubbing writes the plane once per frame.
 */
function useCutControls(
  context: SceneContext,
  section: { sectionAxis: CutAxis; sectionPosition: number; sectionFlipped: boolean },
  active: boolean,
) {
  // Bounds are measured when the cut opens or changes axis, not on every scrubbed frame.
  const range = useMemo(() => {
    if (!active) return null
    const bounds = modelBounds(context)
    return bounds ? axisRange(bounds, section.sectionAxis) : null
  }, [active, context, section.sectionAxis])
  const writer = useMemo(() => createFrameCoalescer((position: number) => useViewer.getState().setSectionPosition(position)), [])
  useEffect(() => () => writer.dispose(), [writer])
  if (!active || !range) return null
  const state: CutState = { axis: section.sectionAxis, position: sliderOf(section.sectionPosition, range), flipped: section.sectionFlipped }
  return {
    state,
    readout: `${section.sectionPosition.toFixed(1)} m`,
    setAxis: (axis: CutAxis) => setCutAxis(axis, context),
    setFlipped: setCutFlipped,
    setPosition: (slider: number) => writer.push(positionOf(slider, range)),
  }
}
