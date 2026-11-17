import { type ReactNode, useId } from 'react'

// Ported from Pascal's /next demo (MIT): Pascal Capture's isometric mark with its 1.4 s face
// reveal, a progress bar and a status line.

const OUTLINE = 'M0 16 28 0 60 18V118L32 136 0 116ZM0 16 32 36 60 18M32 36V136M0 116 32 100 60 118'
const PRISMS = [
  { id: 'outline', x: 31, y: 162 },
  { id: 'mesh', x: 130, y: 92 },
  { id: 'solid', x: 229, y: 22 },
] as const

function faceTiles(width: number) {
  const waves = Array.from({ length: 7 }, () => '')
  const tileWidth = width / 4
  for (let row = 0; row < 10; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const wave = Math.floor(row * 0.6 + column * 0.5)
      const x = column * tileWidth
      const y = row * 10
      // A slight overlap softens antialiased tile edges.
      waves[wave] += `M${x - 0.05} ${y - 0.05}h${tileWidth + 0.1}v10.1h-${tileWidth + 0.1}Z`
    }
  }
  return waves
}

const FACES = [
  { id: 'top', fill: '#fff', width: 0, transform: undefined, mesh: 'M0 16 28 0 60 18 32 36Z', solid: 'M0 16 28 0 60 18 32 36Z' },
  {
    id: 'front', fill: '#eee', width: 32, transform: 'matrix(1 .625 0 1 0 16)',
    mesh: 'M16 0H32V40H24V52H16V35H24V20H16Z M11 26H15V32H11Z M11 64H15V70H11Z M26 72H32V77H26Z',
    solid: 'M0 0H32V100H0Z',
  },
  {
    id: 'side', fill: '#bfbfbf', width: 28, transform: 'matrix(1 -.642857 0 1 32 36)',
    mesh: 'M0 0H28V100H16V86H12V82H8V66H0Z M10 49H14V55H10Z M4 88H8V94H4Z',
    solid: 'M0 0H28V100H0Z',
  },
].map((face) => ({ ...face, waves: face.width ? faceTiles(face.width) : [] }))

function RevealPath({ d, delay }: { d: string; delay: number }) {
  return <path className="sc-loader-reveal" d={d} fillRule="evenodd" style={{ animationDelay: `${delay * 1400}ms` }} />
}

export function LoadingLogo() {
  const id = useId()
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 320 320">
      {PRISMS.map((prism) => (
        <g key={prism.id} transform={`translate(${prism.x} ${prism.y})`}>
          <path d={OUTLINE} stroke="currentColor" strokeLinejoin="round" strokeWidth="1.25" />
          {prism.id !== 'outline' && FACES.map((face) => {
            const d = face[prism.id]
            const clipId = `${id}-${prism.id}-${face.id}`
            const delay = prism.id === 'mesh' ? 0.08 : 0.3
            return (
              <g fill={face.fill} key={face.id} transform={face.transform}>
                {face.width === 0 ? <RevealPath d={d} delay={delay} /> : <>
                  <defs><clipPath id={clipId}><path clipRule="evenodd" d={d} /></clipPath></defs>
                  <g clipPath={`url(#${clipId})`}>
                    {face.waves.map((wave, index) => <RevealPath d={wave} delay={delay + 0.06 + index * 0.065} key={index} />)}
                    {/* The whole face last removes seams between the revealed tiles. */}
                    <RevealPath d={d} delay={0.88} />
                  </g>
                </>}
              </g>
            )
          })}
        </g>
      ))}
    </svg>
  )
}

export type LoaderProgress = { label: string; value: number }

/** The full-screen backdrop and mark every loading, access and error screen shares. */
export function LoaderBackdrop({ children, still = false, leaving = false }: { children: ReactNode; still?: boolean; leaving?: boolean }) {
  return (
    <div className="sc-loading" data-leaving={leaving} data-still={still}>
      <div className="sc-loader-content">
        <div className="sc-loader-mark"><LoadingLogo /></div>
        {children}
      </div>
    </div>
  )
}

export function Loader({ progress = { label: 'Loading', value: 0 }, error, onRetry, leaving = false }: {
  progress?: LoaderProgress
  /** Fading out over the first view. */
  leaving?: boolean
  /** Shown instead of the bar, with a retry. */
  error?: { title: string; detail: string } | null
  onRetry?: () => void
}) {
  const value = Math.max(0, Math.min(100, Math.round(progress.value)))
  return (
    <LoaderBackdrop leaving={leaving} still={!!error}>
      {error ? (
        <div className="sc-loader-error" role="alert">
          <h1>{error.title}</h1>
          <p className="sc-loader-detail">{error.detail}</p>
          {onRetry && <button className="sc-pill" onClick={onRetry} type="button">Try again</button>}
        </div>
      ) : (
        <div className="sc-loader-progress">
          <span className="sc-sr-only" role="status">{progress.label}</span>
          <div aria-label="Loading the project" aria-valuemax={100} aria-valuemin={0} aria-valuenow={value}
            aria-valuetext={`${progress.label}, ${value}%`} className="sc-loader-track" role="progressbar">
            <span style={{ transform: `scaleX(${value / 100})` }} />
          </div>
          <div className="sc-loading-label">
            <span aria-hidden="true" className="sc-loader-status sc-loader-shimmer">{progress.label}</span>
            <span aria-hidden="true" className="sc-loader-percent">{value}%</span>
          </div>
        </div>
      )}
    </LoaderBackdrop>
  )
}
