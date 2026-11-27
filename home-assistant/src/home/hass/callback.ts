/* Home Assistant's sign-in comes back to the viewer as `?auth_callback=1&code=…&state=…`. The
   Pascal sign-in (src/pascal/handoff.ts) takes any `code` and `state` in the address for its own
   and removes them, so this runs first: it keeps Home Assistant's and clears them from the
   address before Pascal looks. No React, no three.js: main.tsx calls it before anything renders. */

export type HassCallback = { code: string; state: string }

let callback: HassCallback | null = null

export function captureHassCallback(): void {
  const url = new URL(location.href)
  if (!url.searchParams.has('auth_callback')) return
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (code && state) callback = { code, state }
  for (const name of ['auth_callback', 'code', 'state']) url.searchParams.delete(name)
  history.replaceState(history.state, '', url.pathname + url.search + url.hash)
}

/** The sign-in that just came back, once: whoever finishes it takes it. */
export function takeHassCallback(): HassCallback | null {
  const taken = callback
  callback = null
  return taken
}
