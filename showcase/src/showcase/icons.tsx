import type { ReactNode, SVGProps } from 'react'

// Ported from Pascal's /next demo (MIT). Original 32-unit drawings for the house controls
// translucent faces give the views depth without textures or a 3D renderer.
const houseOutline = 'M4 13 10 9 22 3 28 13v9l-12 6-12-6Z'
const cubeOutline = 'm16 4 12 6v13l-12 6-12-6V10Z M4 10l12 6 12-6M16 16v13'
const horizontalCut = <>
  <path d={cubeOutline} opacity=".4"/>
  <path d="m3 15 13-6 13 6-13 6Z" fill="currentColor" fillOpacity=".34"/>
  <path d="M16 3v4m-2-2 2 2 2-2"/>
</>

export const dialIcons = {
  exterior: <>
    <path d="M4 13 10 9l6 10v9L4 22Z" fill="currentColor" fillOpacity=".14"/>
    <path d="m16 19 12-6v9l-12 6Z" fill="currentColor" fillOpacity=".28"/>
    <path d="m10 9 12-6 6 10-12 6Z" fill="currentColor" fillOpacity=".42"/>
    <path d="m8 24v-6l4 2v6M21 18l3-1.5v3L21 21Z"/>
  </>,
  exploded: <>
    <path d="m4 25 12 5 12-5"/>
    <path d="m4 18 12-5 12 5-12 5Z" fill="currentColor" fillOpacity=".28"/>
    <path d="m4 8 6-3 6 6Z" fill="currentColor" fillOpacity=".14"/>
    <path d="m10 5 12-4 6 6-12 4Z" fill="currentColor" fillOpacity=".42"/>
    <path d="M4 11v3m24-3v3M4 21v1m24-1v1" opacity=".4" strokeDasharray="1 2"/>
  </>,
  cut: horizontalCut,
  xray: <>
    <path d={houseOutline} fill="currentColor" fillOpacity=".08" opacity=".65"/>
    <path d="m4 13 12 6 12-6M16 19v9M10 9l6 10M22 3l-6 6" opacity=".45"/>
    <path d="m5 19 11-5 11 5-11 5Z" fill="currentColor" fillOpacity=".22"/>
    <path d="M10 15v9m12-13v14M16 10v13"/>
    <path d="m10 15 12-6M10 24l12-6" opacity=".65"/>
    <path d="M2 8V4h4m20 24h4v-4"/>
  </>,
  walkthrough: <>
    <path d="m16 6 11-3v24l-11 3Z" fill="currentColor" fillOpacity=".12"/>
    <path d="m22 7 5-4v24l-5-2Z" fill="currentColor" fillOpacity=".32"/>
    <path d="M16 6v9m0 10v5l6-5M18.5 19H24m-2.5-2.5L24 19l-2.5 2.5"/>
    <circle cx="8.5" cy="8" r="2.5" fill="currentColor" fillOpacity=".3"/>
    <path d="m3 18 3.5-5 4.5 1 3 5h3M8.5 14l-2 8L3 28m3.5-6 5 1.5L14 29"/>
  </>,
  reset: <>
    <circle cx="16" cy="16" r="10.5" opacity=".16" strokeWidth="3"/>
    <path d="M7 10.6a10.5 10.5 0 1 1-.7 9.4" strokeWidth="1.8"/>
    <path d="M7 4.5v7h7" strokeWidth="1.8"/>
  </>,
  night: <>
    <path d="M20 5a11 11 0 1 0 7 15A11 11 0 0 1 20 5Z" fill="currentColor" fillOpacity=".25"/>
    <path d="m24 4 .9 2.7L28 8l-3.1 1.1L24 12l-1-2.9L20 8l3-1.3Z" fill="currentColor" fillOpacity=".45" strokeWidth="1.1"/>
  </>,
  day: <>
    <circle cx="16" cy="16" r="6" fill="currentColor" fillOpacity=".26"/>
    <path d="M16 2v4m0 20v4M2 16h4m20 0h4M6 6l3 3m14 14 3 3M6 26l3-3M23 9l3-3"/>
    <path d="M12 18a4.5 4.5 0 0 1 6-6" opacity=".45"/>
  </>,
  dawn: <>
    <path d="M8 23a8 8 0 0 1 16 0Z" fill="currentColor" fillOpacity=".28"/>
    <path d="M3 23h26M6 28h20"/>
    <path d="M16 11V3m-3 3 3-3 3 3M4 14l3 3m18 0 3-3"/>
    <path d="M12 21a4 4 0 0 1 4-3" opacity=".4"/>
  </>,
  dusk: <>
    <path d="M8 21a8 8 0 0 1 16 0Z" fill="currentColor" fillOpacity=".18"/>
    <path d="M3 21h26M7 25h18m-14 4h10"/>
    <path d="M16 2v8m-3-3 3 3 3-3M4 12l3 3m18 0 3-3"/>
  </>,
  'cut-y': horizontalCut,
  'cut-x': <>
    <path d={cubeOutline} opacity=".4"/>
    <path d="m10 6 12 6v15l-12-6Z" fill="currentColor" fillOpacity=".34"/>
    <path d="m2 18 5 2m-2-3 2 3-3 1"/>
  </>,
  'cut-z': <>
    <path d={cubeOutline} opacity=".4"/>
    <path d="m10 12 12-6v15l-12 6Z" fill="currentColor" fillOpacity=".34"/>
    <path d="m30 18-5 2m2-3-2 3 3 1"/>
  </>,
} satisfies Record<string, ReactNode>

const paths = {
  sound: <><path d="m11 5-5 4H3v6h3l5 4ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/></>,
  muted: <><path d="m11 5-5 4H3v6h3l5 4ZM16 9l5 6m0-6-5 6"/></>,
  expand: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/>,
  flip: <><path d="M4 8h15l-4-4M20 16H5l4 4"/><path d="M12 5v14" strokeDasharray="1 3" opacity=".5"/></>,
  chevron: <path d="m9 5 7 7-7 7"/>,
  up: <path d="m6 14 6-6 6 6"/>,
  down: <path d="m6 10 6 6 6-6"/>,
  // The walkthrough's buttons, /next's drawings.
  jump: <><path d="M12 17V4m-5 5 5-5 5 5M5 19v2h14v-2"/></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
  door: <><path d="M4 21h16M6 21V4l12-2v19M13 12h1"/><path d="M4 4h2"/></>,
  spark: <><path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z"/></>,
  shutters: <><rect x="3" y="4" width="7" height="16" rx="1"/><rect x="14" y="4" width="7" height="16" rx="1"/><path d="M5 8h3m-3 4h3m-3 4h3m8-8h3m-3 4h3m-3 4h3"/></>,
  // X-ray families: /next's category drawings where one matches, new ones in the same hand.
  'family-site': <><path d="m3 8 6-3 6 3 6-3v14l-6 3-6-3-6 3ZM9 5v14M15 8v14"/></>,
  'family-floors': <><rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h18M3 15h18M9 3v6m6 0v6m-6 0v6"/></>,
  'family-walls': <><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M3 15h18M9 4v5m6 0v6m-6 0v5"/></>,
  'family-structure': <><path d="m3 20 9-16 9 16ZM3 20h18M8 12l4 8 4-8M12 4v16"/></>,
  'family-circulation': <><path d="M3 20h4v-4h4v-4h4V8h4V4M3 20h18"/></>,
  'family-openings': <><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M12 3v18M4 12h16"/></>,
  'family-roofs': <><path d="m2 13 10-9 10 9M4 12v8h16v-8M8 8l8 8m-4-12 8 8"/></>,
  'family-roof-services': <><path d="m2 14 10-8 10 8"/><path d="M15 8.5V5h3v6M6 17h12M6 17v3m12-3v3"/></>,
  'family-hvac': <><path d="M3 8h13a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h6a2 2 0 1 1-2 2"/></>,
  'family-plumbing': <><path d="M12 3C9 8 5 11 5 15a7 7 0 0 0 14 0c0-4-4-7-7-12Z"/><path d="M8 15a4 4 0 0 0 4 4"/></>,
  'family-items': <><path d="M5 13V5h14v8M3 11v7h18v-7M5 18v3m14-3v3M3 14h18"/></>,
  'family-other': <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></>,
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof dialIcons | keyof typeof paths

/** The icon for an X-ray family; unknown families get the generic one. */
export const familyIcon = (family: string): IconName =>
  (`family-${family}` in paths ? `family-${family}` : 'family-other') as IconName

/** Dial drawings on a 32-unit grid; utility glyphs on 24. */
export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  const art = (dialIcons as Record<string, ReactNode>)[name]
  return (
    <svg aria-hidden="true" data-dial-icon={art ? name : undefined} fill="none" focusable="false"
      stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={art ? 1.6 : 1.35}
      viewBox={art ? '0 0 32 32' : '0 0 24 24'} {...props}>
      {art ?? (paths as Record<string, ReactNode>)[name]}
    </svg>
  )
}
