import type { Locator } from '@playwright/test'
import { readFile } from 'node:fs/promises'

export async function pluginRenderEntry(packageName: string): Promise<string | undefined> {
  const manifest = JSON.parse(await readFile('dist/runtime-manifest.json', 'utf8')) as Record<string, { file: string }>
  return Object.entries(manifest).find(([key]) => key.includes(`${packageName}/`) && key.endsWith('/render.ts'))?.[1].file
}

/** Read composited pixels: WebGL clears its drawing buffer after presenting. */
export async function renderedColorCount(canvas: Locator): Promise<number> {
  const screenshot = await canvas.screenshot()
  return canvas.page().evaluate(async (base64) => {
    const source = new Image()
    source.src = `data:image/png;base64,${base64}`
    await source.decode()
    const copy = document.createElement('canvas')
    copy.width = copy.height = 96
    const ctx = copy.getContext('2d')!
    ctx.drawImage(source, 0, 0, 96, 96)
    const { data } = ctx.getImageData(0, 0, 96, 96)
    const colors = new Set<string>()
    for (let i = 0; i < data.length; i += 4) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`)
    return colors.size
  }, screenshot.toString('base64'))
}
