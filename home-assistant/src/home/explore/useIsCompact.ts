import { useEffect, useState } from 'react'

const WIDE_QUERY = '(min-width: 768px)'

/**
 * True below the `md` breakpoint (`768px`). Subscribes to both the media query's `change` event
 * and window `resize` so live viewport resizing and DevTools device toggles switch immediately
 * without double-mounting desktop and phone controls.
 */
export function useIsCompact(): boolean {
  const [compact, setCompact] = useState(() => !matchMedia(WIDE_QUERY).matches)
  useEffect(() => {
    const query = matchMedia(WIDE_QUERY)
    const sync = () => setCompact(!query.matches)
    sync()
    query.addEventListener('change', sync)
    addEventListener('resize', sync)
    return () => {
      query.removeEventListener('change', sync)
      removeEventListener('resize', sync)
    }
  }, [])
  return compact
}
