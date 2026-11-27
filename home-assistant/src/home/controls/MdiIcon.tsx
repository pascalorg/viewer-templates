/* Ported from home-assistant/frontend (Apache-2.0): src/components/ha-svg-icon.ts */

export type MdiIconProps = {
  path: string
  className?: string
  size?: number
}

export function MdiIcon({ path, className, size = 20 }: MdiIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d={path} />
    </svg>
  )
}
