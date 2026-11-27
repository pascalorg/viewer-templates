/* Ported from home-assistant/frontend (Apache-2.0): src/components/ha-big-number.ts */

import { blankBeforeUnit, formatNumber } from '../hass/names'

export type BigNumberProps = {
  value: number
  unit?: string
  unitPosition?: 'top' | 'bottom'
  formatOptions?: Intl.NumberFormatOptions
  language?: string
  className?: string
}

export function BigNumber({
  value,
  unit,
  unitPosition = 'top',
  formatOptions,
  language = 'en',
  className = '',
}: BigNumberProps) {
  const formatted = formatNumber(value, language, formatOptions)
  const integer = (formatted.includes('.') ? formatted.split('.')[0] : formatted.split(',')[0]) ?? formatted
  const decimal = formatted.slice(integer.length)
  const accessible = `${formatted}${unit ? `${blankBeforeUnit(unit, language)}${unit}` : ''}`
  const unitBottom = unitPosition === 'bottom'

  return (
    <p
      dir="ltr"
      className={`m-0 flex font-normal leading-[1.12] tracking-[-0.25px] ${className}`}
      style={{ fontSize: 'var(--ha-big-number-size, 52px)' }}
    >
      <span aria-hidden="true" className="inline-flex flex-row items-end">
        <span>{integer}</span>
        {(decimal || unit) && (
          <span
            className={
              unitBottom
                ? 'flex flex-row items-baseline py-1'
                : 'flex flex-col-reverse py-1'
            }
          >
            <span className="min-h-[1.33em] text-[0.42em] leading-[1.33]">{decimal}</span>
            {unit && (
              <span
                className={`text-[0.33em] leading-[1.2] ${unitBottom ? 'mb-1 ml-0.5' : ''}`}
              >
                {unit}
              </span>
            )}
          </span>
        )}
      </span>
      <span className="sr-only">{accessible}</span>
    </p>
  )
}
