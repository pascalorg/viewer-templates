import { type ReactNode, useState } from 'react'

/**
 * Where an arrival intro goes, behind `features.intro`. Render the intro as `children` (captions,
 * a camera flight driven from the viewer store) and call `onDone` when it ends; "Skip intro"
 * ends it early. The dial and top bar stay hidden until it is done.
 */
export function IntroSlot({ children, onDone }: { children?: ReactNode; onDone: () => void }) {
  const [skipped, setSkipped] = useState(false)
  return (
    <div className="sc-intro" data-intro>
      {children}
      <button className="sc-skip" disabled={skipped} onClick={() => { setSkipped(true); onDone() }} type="button">
        {skipped ? 'Intro skipped' : 'Skip intro'}
      </button>
    </div>
  )
}
