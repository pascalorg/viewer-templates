/**
 * What this build of the showcase offers. A flag gates a control that needs viewer support; turn
 * one on only once the pinned `@pascal-app/viewer` can honour it.
 *
 * - `cutView`: the Cut view mode and its section controls (`CutSlider`).
 * - `xray`: the X-ray mode and its family picker.
 * - `touchWalk`: walking by touch (`WalkthroughTouchControls`). Without it, phones and tablets get
 *   no Walkthrough mode, because the desktop walk moves with a keyboard and a locked pointer.
 * - `intro`: the arrival reveal with a "Skip intro" button (`useIntro`, `IntroSlot`).
 */
export type Features = {
  cutView: boolean
  xray: boolean
  touchWalk: boolean
  intro: boolean
}

export const features: Features = {
  cutView: true,
  xray: true,
  touchWalk: true,
  intro: true,
}
