/* Ported from home-assistant/frontend (Apache-2.0):
   - src/common/color/convert-color.ts
   - src/common/color/convert-light-color.ts
   - src/common/color/rgb.ts
   - src/dialogs/more-info/components/lights/light-color-temp-picker.ts (gradient) */

export const DEFAULT_MIN_KELVIN = 2700
export const DEFAULT_MAX_KELVIN = 6500

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const rgbHex = (component: number): string => {
  const hex = Math.round(clamp(component, 0, 255)).toString(16)
  return hex.length === 1 ? `0${hex}` : hex
}

export function hex2rgb(hex: string): [number, number, number] {
  let clean = hex.trim().replace(/^#/, '')
  if (clean.length === 3) {
    clean = `${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`
  }
  return [
    Number.parseInt(clean.substring(0, 2), 16) || 0,
    Number.parseInt(clean.substring(2, 4), 16) || 0,
    Number.parseInt(clean.substring(4, 6), 16) || 0,
  ]
}

export function rgb2hex(rgb: [number, number, number]): string {
  return `#${rgbHex(rgb[0])}${rgbHex(rgb[1])}${rgbHex(rgb[2])}`
}

export function rgb2hsv(rgb: [number, number, number]): [number, number, number] {
  const [r, g, b] = rgb
  const v = Math.max(r, g, b)
  const c = v - Math.min(r, g, b)
  const h = c && (v === r ? (g - b) / c : v === g ? 2 + (b - r) / c : 4 + (r - g) / c)
  return [60 * (h < 0 ? h + 6 : h), v ? c / v : 0, v]
}

export function hsv2rgb(hsv: [number, number, number]): [number, number, number] {
  const [h, s, v] = hsv
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return v - v * s * Math.max(Math.min(k, 4 - k, 1), 0)
  }
  return [f(5), f(3), f(1)]
}

export function rgb2hs(rgb: [number, number, number]): [number, number] {
  const [h, s] = rgb2hsv(rgb)
  return [h, s]
}

export function hs2rgb(hs: [number, number]): [number, number, number] {
  return hsv2rgb([hs[0], hs[1], 255])
}

/** Relative luminance (0..1) per WCAG / HA `common/color/rgb.ts`. */
export function luminosity(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => {
    const srgb = v / 255
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

export function temperature2rgb(temperature: number): [number, number, number] {
  const value = temperature / 100
  const red =
    value <= 66 ? 255 : clamp(329.698727446 * (value - 60) ** -0.1332047592, 0, 255)
  const green =
    value <= 66
      ? clamp(99.4708025861 * Math.log(Math.max(1, value)) - 161.1195681661, 0, 255)
      : clamp(288.1221695283 * (value - 60) ** -0.0755148492, 0, 255)
  const blue =
    value >= 66
      ? 255
      : value <= 19
        ? 0
        : clamp(138.5177312231 * Math.log(value - 10) - 305.0447927307, 0, 255)
  return [Math.round(red), Math.round(green), Math.round(blue)]
}

const matchMaxScale = (inputColors: number[], outputColors: number[]): number[] => {
  const maxIn = Math.max(...inputColors)
  const maxOut = Math.max(...outputColors)
  const factor = maxOut === 0 ? 0 : maxIn / maxOut
  return outputColors.map((value) => Math.round(value * factor))
}

export const mired2kelvin = (miredTemperature: number) =>
  miredTemperature === 0 ? 1_000_000 : Math.floor(1_000_000 / miredTemperature)

export const kelvin2mired = (kelvinTemperature: number) =>
  kelvinTemperature === 0 ? 1_000_000 : Math.floor(1_000_000 / kelvinTemperature)

export function rgbww2rgb(
  rgbww: [number, number, number, number, number],
  minKelvin?: number,
  maxKelvin?: number,
): [number, number, number] {
  const [r, g, b, cw, ww] = rgbww
  const maxMireds = kelvin2mired(minKelvin ?? DEFAULT_MIN_KELVIN)
  const minMireds = kelvin2mired(maxKelvin ?? DEFAULT_MAX_KELVIN)
  const miredRange = maxMireds - minMireds
  const totalWhite = cw + ww
  const ctRatio = totalWhite > 0 ? ww / totalWhite : 0.5
  const colorTempMired = minMireds + ctRatio * miredRange
  const colorTempKelvin = colorTempMired ? mired2kelvin(colorTempMired) : 0
  const [wR, wG, wB] = temperature2rgb(colorTempKelvin)
  const whiteLevel = Math.max(cw, ww) / 255
  const rgb: [number, number, number] = [
    r + wR * whiteLevel,
    g + wG * whiteLevel,
    b + wB * whiteLevel,
  ]
  return matchMaxScale([r, g, b, cw, ww], rgb) as [number, number, number]
}

export function rgbw2rgb(rgbw: [number, number, number, number]): [number, number, number] {
  const [r, g, b, w] = rgbw
  const rgb: [number, number, number] = [r + w, g + w, b + w]
  return matchMaxScale([r, g, b, w], rgb) as [number, number, number]
}

export function generateColorTemperatureGradient(min: number, max: number): string {
  const count = 10
  const step = (max - min) / count
  const pctStep = 100 / count
  const stops: string[] = []
  for (let i = 0; i <= count; i++) {
    const hex = rgb2hex(temperature2rgb(min + step * i))
    stops.push(`${hex} ${pctStep * i}%`)
  }
  return stops.join(', ')
}
