// Ported from Pascal's /next demo (MIT), with a middle button, a click and keycaps added for the
// Pascal viewer's own bindings. 64-unit drawings.

type MouseButton = 'left' | 'right' | 'middle'

function Mouse({ button, wheel = false, click = false }: { button?: MouseButton; wheel?: boolean; click?: boolean }) {
  const lit = wheel || button === 'middle'
  return <>
    <path d="M21 29V24a11 11 0 0 1 22 0v16a11 11 0 0 1-22 0Z" fill="currentColor" fillOpacity=".06" />
    {(button === 'left' || button === 'right') && <path d={button === 'left' ? 'M21 29v-5a11 11 0 0 1 11-11v16Z' : 'M32 13a11 11 0 0 1 11 11v5H32Z'}
      fill="currentColor" fillOpacity=".32" stroke="none" />}
    <path d="M21 29h22M32 13v16" opacity=".45" />
    <rect fill="currentColor" fillOpacity={lit ? '.85' : '.2'} height="8" rx="2" stroke="none" width="4" x="30" y="18" />
    {wheel ? <path d="M51 17v24m-3-21 3-3 3 3m-6 18 3 3 3-3" />
      : click ? <path d="M16 12l-4-4M13 19H7M20 7V2" opacity=".7" />
        : <>
          <path d="M5 34h10m-7-3-3 3 3 3m4-6 3 3-3 3" />
          <path d="M49 34h10m-7-3-3 3 3 3m4-6 3 3-3 3" />
        </>}
  </>
}

function Finger({ x = 28, y = 24, rotate = 0 }: { x?: number; y?: number; rotate?: number }) {
  return <g transform={`translate(${x} ${y}) rotate(${rotate})`}>
    <rect fill="currentColor" fillOpacity=".1" height="27" rx="4.5" width="9" />
    <path d="M2.5 7V5a2 2 0 0 1 4 0v2Z" fill="currentColor" fillOpacity=".4" stroke="none" />
  </g>
}

function Drag({ two = false }: { two?: boolean }) {
  return <>
    <path d="M12 13h40m-5-5 5 5-5 5M17 8l-5 5 5 5" />
    {two ? <><Finger x={20} /><Finger x={35} /></> : <Finger />}
    <path d="M20 56h24" opacity=".18" />
  </>
}

/** A keycap; wide for modifier names. */
function Key({ label }: { label: string }) {
  const wide = label.length > 1
  const width = wide ? 40 : 28
  return <>
    <rect fill="currentColor" fillOpacity=".12" height="28" rx="6" width={width} x={32 - width / 2} y="18" />
    <text fill="currentColor" fontFamily="inherit" fontSize={wide ? 11 : 15} stroke="none" textAnchor="middle" x="32" y={wide ? 36 : 37}>{label}</text>
  </>
}

const WASD: [string, number, number][] = [['W', 25, 13], ['A', 8, 31], ['S', 25, 31], ['D', 42, 31]]

export type GestureName =
  | 'mouse-rotate' | 'mouse-pan' | 'mouse-zoom' | 'mouse-select'
  | 'touch-rotate' | 'touch-pan' | 'touch-zoom' | 'tap' | 'tap-jump' | 'joystick' | 'tap-exit'
  | 'keys' | 'look' | 'jump' | `key:${string}`

export function GestureIcon({ name }: { name: GestureName }) {
  return <svg aria-hidden="true" data-gesture={name} fill="none" focusable="false" stroke="currentColor" strokeLinecap="round"
    strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 64 64">
    {name === 'mouse-rotate' && <Mouse button="left" />}
    {name === 'mouse-pan' && <Mouse button="right" />}
    {name === 'mouse-zoom' && <Mouse wheel />}
    {name === 'mouse-select' && <Mouse button="left" click />}
    {name === 'touch-rotate' && <Drag />}
    {name === 'touch-pan' && <Drag two />}
    {name === 'touch-zoom' && <>
      <Finger rotate={-24} x={13} y={31} /><Finger rotate={24} x={43} y={31} />
      <path d="m25 26-13-13m0 7v-7h7m20 13 13-13m-7 0h7v7" />
      <path d="M27 34h10" opacity=".4" strokeDasharray="2 4" />
    </>}
    {(name === 'tap' || name === 'tap-jump' || name === 'tap-exit') && <>
      <circle cx="32" cy="23" opacity=".25" r="15" />
      <circle cx="32" cy="23" fill="currentColor" fillOpacity=".12" r="10" />
      {name === 'tap-jump' && <path d="M32 26V17m-3 3 3-3 3 3" />}
      {name === 'tap-exit' && <path d="m28 19 8 8m0-8-8 8" />}
      <Finger x={28} y={31} /><path d="M12 23H7m45 0h5M19 9l-3-3m29 3 3-3" opacity=".6" />
    </>}
    {name === 'joystick' && <>
      <circle cx="28" cy="37" opacity=".35" r="18" /><circle cx="28" cy="37" opacity=".2" r="11" />
      <circle cx="35" cy="29" fill="currentColor" fillOpacity=".24" r="8" />
      <path d="m44 20 8-8m-7 0h7v7" />
    </>}
    {name === 'keys' && WASD.map(([key, x, y]) => <g key={key}>
      <rect fill="currentColor" fillOpacity=".12" height="14" rx="3" width="14" x={x} y={y} />
      <text fill="currentColor" fontFamily="inherit" fontSize="8" stroke="none" textAnchor="middle" x={x + 7} y={y + 10}>{key}</text>
    </g>)}
    {name === 'look' && <Mouse />}
    {name === 'jump' && <>
      <rect fill="currentColor" fillOpacity=".12" height="13" rx="4" width="46" x="9" y="34" />
      <path d="M32 27V12m-5 5 5-5 5 5M20 40h24" />
    </>}
    {name.startsWith('key:') && <Key label={name.slice(4)} />}
  </svg>
}
