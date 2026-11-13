import { useViewer, type WalkthroughMovement } from '@pascal-app/viewer'
import { ViewerControlsBar, type ViewerLinkProps, ViewerSceneHeader, type ViewerSource } from '@pascal-app/viewer/ui'

// The header always links the owner line to a Pascal profile path. The public read
// returns no profile address yet, so the owner's name shows as plain text.
function OwnerText({ href, className, children }: ViewerLinkProps) {
  if (!href.startsWith('/u/')) return <a className={className} href={href}>{children}</a>
  return <span className={className}>{href.slice(3)}</span>
}

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

/** Scene header (top left) and controls bar (bottom center), as on editor.pascal.app. */
export function ViewerOverlay({ projectName, ownerName, glbActive, glbHasScans, glbHasGuides, hideHeader, hideBottomBar, source }: {
  projectName: string | null
  /** Shown under the project name; null in embeds. */
  ownerName: string | null
  /** A ready bake is on screen: the bar hides controls a GLB can't honour (wall modes). */
  glbActive: boolean
  /** Scans/guides rebuilt from the graph over the bake, so their toggles show. */
  glbHasScans: boolean
  glbHasGuides: boolean
  hideHeader: boolean
  hideBottomBar: boolean
  /** The scene the header navigates: the published graph over a bake, or the live store. */
  source: ViewerSource
}) {
  const walkthroughMode = useViewer((s) => s.walkthroughMode)
  const walkthroughMovement = useViewer((s) => s.walkthroughMovement)

  return (
    <>
      {!hideHeader && (
        <ViewerSceneHeader
          // Nowhere to go back to in a standalone viewer.
          backHref={null}
          linkComponent={OwnerText}
          owner={ownerName ? { username: ownerName } : null}
          projectName={projectName}
          source={source}
        />
      )}

      {/* Hidden in walkthrough; Escape exits. */}
      {!(hideBottomBar || walkthroughMode) && (
        <ViewerControlsBar
          droneActive={walkthroughMode && walkthroughMovement === 'drone'}
          glbActive={glbActive}
          glbHasGuides={glbHasGuides}
          glbHasScans={glbHasScans}
          onDroneToggle={() => toggleWalkthrough('drone')}
          onWalkthroughToggle={() => toggleWalkthrough('walk')}
          walkthroughActive={walkthroughMode && walkthroughMovement === 'walk'}
        />
      )}
    </>
  )
}
