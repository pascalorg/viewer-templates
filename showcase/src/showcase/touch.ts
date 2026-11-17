/**
 * Whether the visitor walks by touch, decided from real input: the last pointer that pressed the
 * page, or, before any press, a coarse primary pointer. A laptop with a touch screen walks by touch
 * only when it was touched.
 */
let lastPointer: string | null = null

export function trackPointerType(): () => void {
  const note = (event: PointerEvent) => { lastPointer = event.pointerType }
  addEventListener('pointerdown', note, { capture: true, passive: true })
  return () => removeEventListener('pointerdown', note, { capture: true })
}

export function walkingByTouch(): boolean {
  return lastPointer ? lastPointer === 'touch' : matchMedia('(pointer: coarse)').matches
}
