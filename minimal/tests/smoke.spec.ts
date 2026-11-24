import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { expect, type Page, test } from '@playwright/test'
import type { SceneGraph } from '../src/pascal'
import { readSpaces, roomContents, thingOf } from '../src/spaces'
import { placeTags } from '../src/ui/tagLayout'
import { pascalHover, pascalLabel } from '../src/viewer/pascalRules'
import { cors, GLB_URL, mockPascal, sceneBody } from './pascal-mocks'

const fixtures = new URL('./fixtures/', import.meta.url)
const liveGraph = JSON.parse(readFileSync(new URL('live-scene.json', fixtures), 'utf8'))
const cube = readFileSync(new URL('cube.gltf', fixtures))

async function expectBakedReady(page: Page) {
  // Navigation can finish before the scrubbed callback's dynamic app import. Cold
  // software WebGL and KTX2 startup also belong to scene readiness, not page load.
  // Use the live scene's readiness budget; keep ordinary UI assertions at 5 seconds.
  await expect(page.locator('main[data-state="ready"]')).toBeVisible({ timeout: 20_000 })
}

/** Distinct colours in the rendered canvas: 1 for an empty clear colour, many for a model. */
async function canvasColours(page: Page) {
  // The overlay's tags sit over the canvas; the open room's is filled in the accent.
  const png = await page.locator('canvas').screenshot({ mask: [page.locator('.room-tag')] })
  return page.evaluate(async (base64) => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    context.drawImage(image, 0, 0)
    const { data } = context.getImageData(0, 0, image.width, image.height)
    const colours = new Set<number>()
    for (let i = 0; i < data.length; i += 4 * 7) {
      colours.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!)
    }
    return colours.size
  }, png.toString('base64'))
}

test('renders the baked model and lists its floors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
  await mockPascal(page)

  await page.goto('/?project=fixture-house')
  await expectBakedReady(page)
  await expect(page.getByRole('heading', { name: 'Fixture house' })).toBeVisible()
  await expect(page.locator('canvas')).toBeVisible()
  expect(await canvasColours(page)).toBeGreaterThan(50)

  // Spaces lists every floor, top first, with its rooms and their areas.
  await page.getByRole('button', { name: /^Spaces/ }).click()
  const spaces = page.getByRole('navigation', { name: 'Spaces' })
  await expect(spaces.locator('.nav-row.is-floor')).toHaveText([/^All floors/, /^First floor/, /^Ground floor/])
  await expect(spaces.locator('.nav-row.is-room')).toHaveText([/^Bedroom/, /^Kitchen\s*18 m²/, /^Living room\s*30 m²/])
  await showGroundFloor(page)
  await expect(spaces.getByRole('button', { name: /^Ground floor/ })).toHaveAttribute('aria-current', 'true')
  expect(errors).toEqual([])
})

/** Shows the ground floor alone, by its key: 1 is every floor, then each floor from the top. */
async function showGroundFloor(page: Page) {
  await page.keyboard.press('3')
  await page.waitForTimeout(600)
}

/** Opens a room from the spaces panel, and closes the panel again. */
async function openRoom(page: Page, name: string) {
  await page.keyboard.press('s')
  await page.getByRole('navigation', { name: 'Spaces' }).getByRole('button', { name: new RegExp(`^${name}`) }).click()
  await page.keyboard.press('s')
  await expect(page.getByRole('complementary', { name: 'Details' }).getByRole('heading', { name })).toBeVisible()
  await page.waitForTimeout(1000)
}

/** Scans the drawing for a spot where the pointer turns into a hand (a door, window or item). */
async function findPointer(page: Page, step = 0.03) {
  const canvas = page.locator('canvas')
  const box = (await canvas.boundingBox())!
  for (let y = 0.95; y >= 0.2; y -= step) {
    for (let x = 0.15; x <= 0.85; x += step) {
      const point = { x: box.x + box.width * x, y: box.y + box.height * y }
      await page.mouse.move(point.x, point.y)
      if ((await canvas.evaluate((element) => element.style.cursor)) === 'pointer') return point
    }
  }
  return null
}

/** Scans the drawing for a spot where the pointer tag names `name`. */
async function findNamed(page: Page, name: string, step = 0.02) {
  const canvas = page.locator('canvas')
  const tag = page.locator('.pointer-tag')
  const box = (await canvas.boundingBox())!
  for (let y = 0.95; y >= 0.2; y -= step) {
    for (let x = 0.15; x <= 0.85; x += step) {
      const point = { x: box.x + box.width * x, y: box.y + box.height * y }
      await page.mouse.move(point.x, point.y)
      if ((await tag.count()) && (await tag.innerText()).trim() === name) return point
    }
  }
  return null
}

/** Opens whichever room the front door belongs to, and finds the door in it. */
async function openRoomWithDoor(page: Page) {
  for (const name of ['Living room', 'Kitchen']) {
    await openRoom(page, name)
    const door = await findPointer(page)
    if (door) return door
  }
  return null
}

test('names the room under the pointer with its area', async ({ page }) => {
  await mockPascal(page)
  await page.goto('/?project=fixture-house')
  await expectBakedReady(page)
  await showGroundFloor(page)

  const box = (await page.locator('canvas').boundingBox())!
  const label = page.locator('.room-tag.is-hot')
  const seen = new Set<string>()
  for (let y = 0.3; y <= 0.8; y += 0.1) {
    for (let x = 0.2; x <= 0.8; x += 0.1) {
      await page.mouse.move(box.x + box.width * x, box.y + box.height * y)
      if (await label.isVisible()) seen.add((await label.innerText()).replace(/\s+/g, ' '))
    }
  }
  expect([...seen]).toEqual(
    expect.arrayContaining([expect.stringMatching(/^(Living room 30|Kitchen 18) m²$/)]),
  )

  // The link runs both ways: the room pointed at on the drawing lights its row in Spaces.
  await page.keyboard.press('s')
  const spaces = page.getByRole('navigation', { name: 'Spaces' })
  let lit = false
  for (let y = 0.3; y <= 0.8 && !lit; y += 0.1) {
    for (let x = 0.4; x <= 0.8 && !lit; x += 0.1) {
      await page.mouse.move(box.x + box.width * x, box.y + box.height * y)
      if (!(await label.isVisible())) continue
      const name = (await label.innerText()).startsWith('Kitchen') ? 'Kitchen' : 'Living room'
      await expect(spaces.getByRole('button', { name: new RegExp(`^${name}`) })).toHaveClass(/is-hot/)
      lit = true
    }
  }
  expect(lit).toBe(true)
})

test('answers in rooms alone until one is open: no hand, no accent', async ({ page }) => {
  await mockPascal(page)
  await page.goto('/?project=fixture-house')
  await expectBakedReady(page)
  await showGroundFloor(page)
  expect(await findPointer(page, 0.05)).toBeNull()
  expect(await accentPixels(page)).toBeLessThan(50)
})

test('opens a door on click and closes it on a second click', async ({ page }) => {
  await mockPascal(page)
  await page.goto('/?project=fixture-house')
  await expectBakedReady(page)
  await showGroundFloor(page)

  const canvas = page.locator('canvas')
  const door = await openRoomWithDoor(page)
  expect(door).not.toBeNull()

  const closed = await canvas.screenshot()
  await page.mouse.click(door!.x, door!.y)
  await page.waitForTimeout(1300)
  const opened = await canvas.screenshot()
  expect(opened.equals(closed)).toBe(false)
  await page.mouse.click(door!.x, door!.y)
  await page.waitForTimeout(1300)
  expect((await canvas.screenshot()).equals(opened)).toBe(false)
})

/** Pixels close to the accent blue in the rendered canvas. */
async function accentPixels(page: Page) {
  // The overlay's tags sit over the canvas; the open room's is filled in the accent.
  const png = await page.locator('canvas').screenshot({ mask: [page.locator('.room-tag')] })
  return page.evaluate(async (base64) => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    context.drawImage(image, 0, 0)
    const { data } = context.getImageData(0, 0, image.width, image.height)
    let count = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 2]! > 150 && data[i + 2]! - data[i]! > 80) count++
    }
    return count
  }, png.toString('base64'))
}

test('draws in monochrome and lights up the door under the pointer', async ({ page }) => {
  await mockPascal(page)
  await page.goto('/?project=fixture-house')
  await expectBakedReady(page)
  await showGroundFloor(page)
  // The drawing itself has no colour.
  const marker = 400
  await expect.poll(() => accentPixels(page)).toBeLessThan(marker)

  const canvas = page.locator('canvas')
  const box = (await canvas.boundingBox())!
  expect(await openRoomWithDoor(page)).not.toBeNull()
  await expect.poll(() => accentPixels(page)).toBeGreaterThan(marker * 3)
  await page.mouse.move(box.x + 4, box.y + 4)
  await expect.poll(() => accentPixels(page)).toBeLessThan(marker)
})

/** Pixels in the cutaway's section fill (STYLE.section), a mid grey a little bluer than the paper. */
async function sectionPixels(page: Page) {
  // The overlay's tags sit over the canvas; the open room's is filled in the accent.
  const png = await page.locator('canvas').screenshot({ mask: [page.locator('.room-tag')] })
  return page.evaluate(async (base64) => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    context.drawImage(image, 0, 0)
    const { data } = context.getImageData(0, 0, image.width, image.height)
    let count = 0
    for (let i = 0; i < data.length; i += 4) {
      const near = Math.abs(data[i]! - 0xa9) < 5 && Math.abs(data[i + 1]! - 0xab) < 5 && Math.abs(data[i + 2]! - 0xb1) < 5
      if (near) count++
    }
    return count
  }, png.toString('base64'))
}

test('opens the room under the pointer by cutting the walls in front of it', async ({ page }) => {
  await mockPascal(page)
  await page.goto('/?project=fixture-house')
  await expectBakedReady(page)
  await showGroundFloor(page)
  await page.waitForTimeout(300)
  const closed = await sectionPixels(page)

  const box = (await page.locator('canvas').boundingBox())!
  const label = page.locator('.room-tag.is-hot')
  let found = false
  for (let y = 0.4; y <= 0.7 && !found; y += 0.05) {
    for (let x = 0.35; x <= 0.65 && !found; x += 0.05) {
      await page.mouse.move(box.x + box.width * x, box.y + box.height * y)
      found = await label.isVisible()
    }
  }
  expect(found).toBe(true)
  await expect.poll(() => sectionPixels(page)).toBeGreaterThan(closed + 300)

  // Leaving the model closes the room again, after a short delay.
  await page.mouse.move(box.x + 4, box.y + 4)
  await expect.poll(() => sectionPixels(page)).toBeLessThan(closed + 100)
})

test('selects a room on click, frames it, and closes it with its button or Escape', async ({ page }) => {
  await mockPascal(page)
  await page.goto('/?project=fixture-house')
  await expectBakedReady(page)
  await showGroundFloor(page)

  const canvas = page.locator('canvas')
  const box = (await canvas.boundingBox())!
  let point: { x: number; y: number } | null = null
  for (let y = 0.4; y <= 0.7 && !point; y += 0.05) {
    for (let x = 0.35; x <= 0.65 && !point; x += 0.05) {
      const at = { x: box.x + box.width * x, y: box.y + box.height * y }
      await page.mouse.move(at.x, at.y)
      const label = page.locator('.room-tag.is-hot')
      if ((await label.isVisible()) && /m²/.test(await label.innerText())) point = at
    }
  }
  expect(point).not.toBeNull()
  const before = await canvas.screenshot()
  await page.mouse.click(point!.x, point!.y)
  const details = page.getByRole('complementary', { name: 'Details' })
  await expect(details).toBeVisible()
  await expect(details.getByRole('heading', { level: 2 })).toHaveText(/Living room|Kitchen/)
  await expect(details.locator('.stat')).toContainText([/m²\s*Area/, /×.*m\s*Size/])
  await page.waitForTimeout(1000)
  expect((await canvas.screenshot()).equals(before)).toBe(false)

  await details.getByRole('button', { name: 'Close details' }).click()
  await expect(details).toBeHidden()

  await page.mouse.click(point!.x, point!.y)
  await expect(details).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(details).toBeHidden()
})

test('pins a tag on every room of the floor shown, and keeps the others when one is open', async ({ page }) => {
  await mockPascal(page)
  await page.goto('/?project=fixture-house')
  await expectBakedReady(page)
  const tags = page.locator('.room-tag')
  // Every floor at once: no tags.
  await expect(tags).toHaveCount(0)
  await showGroundFloor(page)
  await expect(tags).toHaveText([/^Kitchen\s*18 m²/, /^Living room\s*30 m²/])

  await tags.filter({ hasText: 'Kitchen' }).click()
  const details = page.getByRole('complementary', { name: 'Details' })
  await expect(details.getByRole('heading', { name: 'Kitchen' })).toBeVisible()
  // The open room keeps its tag, drawn current; the others stay.
  await expect(tags).toHaveText([/^Kitchen/, /^Living room/])
  await expect(page.locator('.room-tag[aria-current="true"]')).toHaveText(/^Kitchen/)

  // Pointing at another room's tag lights it; clicking it opens that room.
  const living = tags.filter({ hasText: 'Living room' })
  await living.hover()
  await expect(living).toHaveClass(/is-hot/)
  await living.click()
  await expect(details.getByRole('heading', { name: 'Living room' })).toBeVisible()
  await expect(page.locator('.room-tag[aria-current="true"]')).toHaveText(/^Living room/)
})

test('places room tags without overlap: larger rooms first, the rest as pins or not at all', () => {
  const tag = (id: string, x: number, y: number, priority: number) => ({ id, x, y, width: 120, height: 28, priority })
  // Three rooms sharing a spot: the largest keeps it, the next goes one tag up, the third one down.
  const stacked = placeTags([
    tag('third', 100, 100, 10),
    tag('first', 100, 100, 30),
    tag('second', 100, 100, 20),
    tag('far', 600, 100, 1),
    tag('fourth', 105, 100, 5),
  ])
  expect(stacked.get('first')).toBe(0)
  expect(stacked.get('second')).toBe(-32)
  expect(stacked.get('third')).toBe(32)
  expect(stacked.get('far')).toBe(0)
  // No clear spot, and its pin would land on a tag: nothing shows until its room is pointed at.
  expect(stacked.get('fourth')).toBe('hidden')
  // No clear spot, but its anchor is: a pin.
  const pinned = placeTags([tag('a', 100, 100, 3), tag('b', 100, 100, 2), tag('c', 100, 100, 1), tag('d', 200, 100, 0)])
  expect(pinned.get('d')).toBe('pin')
})

test('lists furniture with items: cabinet runs, their modules, shelves and what stands on them', () => {
  const node = (id: string, type: string, parentId: string | null, fields: Record<string, unknown> = {}) => ({
    id, type, parentId, name: id, ...fields,
  })
  const nodes = [
    node('level', 'level', null, { level: 0 }),
    node('Kitchen', 'zone', 'level', { polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] }),
    // A run turned a quarter: its modules' offsets turn with it.
    node('Run', 'cabinet', 'level', { position: [3.5, 0, 1], rotation: Math.PI / 2, width: 0.6, depth: 0.58 }),
    node('Sink base', 'cabinet-module', 'Run', { position: [0, 0.1, -2], rotation: 0, width: 0.9, depth: 0.58, carcassHeight: 0.72 }),
    node('Wall cabinet', 'cabinet-module', 'Sink base', { position: [0, 1.35, -0.13], rotation: 0, width: 0.9, depth: 0.32, carcassHeight: 0.72 }),
    // Unturned, this one would stand inside; turned, it stands at z = -1, outside.
    node('Fridge', 'cabinet-module', 'Run', { position: [2, 0.1, 0], rotation: 0, width: 0.76, depth: 0.58, carcassHeight: 2.07 }),
    node('Shelf', 'shelf', 'level', { position: [1, 0, 3], rotation: [0, 0, 0], width: 1.3, depth: 0.6, height: 0.84 }),
    node('Microwave', 'item', 'Shelf', { position: [0.2, 0.9, 0], rotation: [0, 0, 0], asset: { dimensions: [0.5, 0.3, 0.4] } }),
  ]
  const graph = {
    nodes: Object.fromEntries(nodes.map((each) => [each.id, each])),
    rootNodeIds: ['level'],
  } as unknown as SceneGraph
  const room = readSpaces(graph).rooms.get('Kitchen')!
  expect(roomContents(graph, room).map((thing) => thing.name)).toEqual(['Microwave', 'Run', 'Shelf', 'Sink base', 'Wall cabinet'])
  expect(thingOf(graph, 'Sink base')).toMatchObject({ category: 'Cabinet module', size: [0.9, 0.58, 0.72] })
  // A run's own width is a stub; its modules make its length.
  expect(thingOf(graph, 'Run')).toMatchObject({ category: 'Cabinet run', size: null })
  expect(thingOf(graph, 'Shelf')).toMatchObject({ category: 'Shelf', size: [1.3, 0.6, 0.84] })
})

test("hovers and names things by Pascal's viewer rules", () => {
  const node = (id: string, type: string, parentId: string | null, fields: Record<string, unknown> = {}) => ({
    id, type, parentId, ...fields,
  })
  const nodes = [
    node('level', 'level', null),
    node('zone', 'zone', 'level', { name: 'Kitchen' }),
    node('wall', 'wall', 'level'),
    node('ceiling', 'ceiling', 'level'),
    node('roof', 'roof', 'level'),
    node('segment', 'roof-segment', 'roof'),
    node('run', 'cabinet', 'level', { name: 'Kitchen Island' }),
    node('module', 'cabinet-module', 'run'),
    node('lamp', 'item', 'level', { asset: { name: 'Arc Lamp' } }),
    node('handle', 'item', 'run', { metadata: { nodeSelectionProxyId: 'run' } }),
    node('column', 'column', 'level'),
  ]
  const graph = {
    nodes: Object.fromEntries(nodes.map((each) => [each.id, each])),
    rootNodeIds: ['level'],
  } as unknown as SceneGraph
  // Kinds the pointer passes through answer nothing; a roof's part answers as the roof.
  expect(['level', 'zone', 'ceiling'].map((id) => pascalHover(graph, id))).toEqual([null, null, null])
  expect(pascalHover(graph, 'segment')).toBe('roof')
  // Any other kind answers as itself, or as the node it hands its selection to.
  expect(['wall', 'module', 'column', 'handle'].map((id) => pascalHover(graph, id))).toEqual(['wall', 'module', 'column', 'run'])
  // Names: its own, an item's catalogue name, or a word for its kind.
  expect(['run', 'module', 'lamp', 'column', 'segment'].map((id) => pascalLabel(graph, id))).toEqual([
    'Kitchen Island', 'Cabinet', 'Arc Lamp', 'Column', 'roof-segment',
  ])
})

test('answers in floors with every floor shown: hover names one, a click shows it alone', async ({ page }) => {
  await mockPascal(page)
  await page.goto('/?project=fixture-house')
  await expectBakedReady(page)
  await expect(page.locator('.room-tag')).toHaveCount(0)

  const canvas = page.locator('canvas')
  const box = (await canvas.boundingBox())!
  const tag = page.locator('.pointer-tag')
  let point: { x: number; y: number } | null = null
  for (let y = 0.35; y <= 0.75 && !point; y += 0.05) {
    for (let x = 0.3; x <= 0.7 && !point; x += 0.05) {
      const at = { x: box.x + box.width * x, y: box.y + box.height * y }
      await page.mouse.move(at.x, at.y)
      if (await tag.isVisible()) point = at
    }
  }
  expect(point).not.toBeNull()
  await expect(tag).toHaveText(/^(First|Ground) floor/)
  const floor = (await tag.innerText()).startsWith('First') ? 'First floor' : 'Ground floor'
  await expect.poll(() => canvas.evaluate((element) => element.style.cursor)).toBe('pointer')

  // A click goes into the floor, not a room: no details, the floor's rooms tagged.
  await page.mouse.click(point!.x, point!.y)
  await expect(page.getByRole('complementary', { name: 'Details' })).toBeHidden()
  await page.getByRole('button', { name: 'Section' }).click()
  await expect(page.getByRole('radiogroup', { name: 'Cut above' }).getByRole('radio', { name: new RegExp(`^${floor}`) }))
    .toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
  await expect(page.locator('.room-tag').first()).toBeVisible()

  // Esc steps back out to every floor.
  await page.keyboard.press('Escape')
  await expect(page.locator('.room-tag')).toHaveCount(0)
})

test('finds a room by name in the spaces panel and opens its details', async ({ page }) => {
  await mockPascal(page)
  await page.goto('/?project=fixture-house')
  await expectBakedReady(page)

  await page.keyboard.press('/')
  const search = page.getByRole('searchbox', { name: 'Search spaces' })
  await expect(search).toBeFocused()
  await search.fill('kit')
  const spaces = page.getByRole('navigation', { name: 'Spaces' })
  await expect(spaces.locator('.nav-row')).toHaveText([/^Kitchen/])
  await search.fill('attic')
  await expect(spaces).toContainText('No space matches')
  await spaces.getByRole('button', { name: 'Clear search' }).click()

  await spaces.getByRole('button', { name: /^Kitchen/ }).click()
  const details = page.getByRole('complementary', { name: 'Details' })
  await expect(details.getByRole('heading', { name: 'Kitchen' })).toBeVisible()
  // The floor is named once, in the crumbs.
  await expect(details.locator('.insp-kind')).toHaveText('Room')
  await expect(details.getByRole('navigation', { name: 'Location' })).toContainText('Ground floor')
  await expect(details).toContainText('Nothing is placed in this room.')
  await expect(spaces.getByRole('button', { name: /^Kitchen/ })).toHaveAttribute('aria-current', 'true')

  // Esc steps back: the room closes, then the panel.
  await search.blur()
  await page.keyboard.press('Escape')
  await expect(details).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(spaces).toBeHidden()
})

test('measures the distance between two points picked on the drawing', async ({ page }) => {
  await mockPascal(page)
  await page.goto('/?project=fixture-house')
  await expectBakedReady(page)

  await page.keyboard.press('m')
  const strip = page.getByRole('group', { name: 'Measure' })
  await expect(strip).toContainText('Pick a first point')
  const box = (await page.locator('canvas').boundingBox())!
  await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.5)
  await expect(strip).toContainText('Pick a second point')
  await page.mouse.click(box.x + box.width * 0.58, box.y + box.height * 0.55)
  await expect(strip).toContainText(/Distance \d+\.\d{1,2} m/)
  await expect(page.locator('.readout')).toHaveText(/\d+\.\d{1,2} m/)

  await strip.getByRole('button', { name: 'Clear' }).click()
  await expect(strip).toContainText('Pick a first point')
  await page.keyboard.press('Escape')
  await expect(strip).toBeHidden()
})

test('cuts above a floor from the section strip, and lists the shortcuts', async ({ page }) => {
  await mockPascal(page)
  await page.goto('/?project=fixture-house')
  await expectBakedReady(page)

  await page.getByRole('button', { name: 'Section' }).click()
  const cut = page.getByRole('radiogroup', { name: 'Cut above' })
  await expect(cut.getByRole('radio')).toHaveText([/^No cut/, /^First floor/, /^Ground floor/])
  await expect(cut.getByRole('radio', { name: /^No cut/ })).toHaveAttribute('aria-checked', 'true')
  const whole = await page.locator('canvas').screenshot()
  await cut.getByRole('radio', { name: /^Ground floor/ }).click()
  await expect(cut.getByRole('radio', { name: /^Ground floor/ })).toHaveAttribute('aria-checked', 'true')
  await page.waitForTimeout(1000)
  expect((await page.locator('canvas').screenshot()).equals(whole)).toBe(false)

  await page.getByRole('button', { name: 'Shortcuts and help' }).click()
  const help = page.getByRole('dialog', { name: 'Shortcuts' })
  await expect(help).toBeVisible()
  await expect(help).toContainText('Measure')
  await page.keyboard.press('Escape')
  await expect(help).toBeHidden()
})

test('turns a quarter, switches to plan and back, and frames the building', async ({ page }) => {
  await mockPascal(page)
  await page.goto('/?project=fixture-house')
  await expectBakedReady(page)
  const canvas = page.locator('canvas')
  const axonometric = page.getByRole('button', { name: 'Axo' })
  const plan = page.getByRole('button', { name: 'Plan' })
  await expect(axonometric).toHaveAttribute('aria-pressed', 'true')

  const start = await canvas.screenshot()
  await page.getByRole('button', { name: 'Turn right' }).click()
  await page.waitForTimeout(1000)
  const turned = await canvas.screenshot()
  expect(turned.equals(start)).toBe(false)

  await plan.click()
  await expect(plan).toHaveAttribute('aria-pressed', 'true')
  await page.waitForTimeout(1000)
  expect((await canvas.screenshot()).equals(turned)).toBe(false)

  // P toggles the projection; arrows turn; F frames.
  await page.keyboard.press('p')
  await expect(axonometric).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(1000)
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, -600)
  await page.waitForTimeout(300)
  const zoomed = await canvas.screenshot()
  await page.keyboard.press('f')
  await page.waitForTimeout(1000)
  const framed = await canvas.screenshot()
  expect(framed.equals(zoomed)).toBe(false)
  expect(await canvasColours(page)).toBeGreaterThan(20)
})

test('renews an expired 3D file URL by reading the scene again', async ({ page }) => {
  const calls = await mockPascal(page, (n) => ({
    body: sceneBody(n === 1 ? { expiresAt: new Date(Date.now() - 1000).toISOString() } : {}),
  }))
  await page.goto('/?project=fixture-house')
  await expectBakedReady(page)
  expect(calls).toEqual({ scene: 2, glb: 1 })
})

test('renews once when storage rejects the signed URL', async ({ page }) => {
  const calls = await mockPascal(page, undefined, (n) => (n === 1 ? 400 : 200))
  await page.goto('/?project=fixture-house')
  await expectBakedReady(page)
  expect(calls).toEqual({ scene: 2, glb: 2 })
})

async function mockLiveAssets(page: Page) {
  await page.route('https://editor.pascal.app/cube.gltf', (route) =>
    route.fulfill({ body: cube, contentType: 'model/gltf+json', headers: cors }))
}

for (const status of ['none', 'failed', 'baking', 'ready']) {
  test(`rebuilds the graph live when bake status is ${status} with no LODs`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
    const calls = await mockPascal(page, () => ({
      body: sceneBody({ graph: liveGraph, bake: { status, bakeVersion: null, hash: null, lods: [] } }),
    }))
    await mockLiveAssets(page)
    await page.goto('/?project=fixture-house')
    await expect(page.locator('main[data-source="live"][data-scene-ready="true"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('heading', { name: 'Fixture house' })).toBeVisible()
    // Captured and drawn like a bake: the runtime's own canvas is gone, the drawing's is up.
    await expect(page.locator('.live-build')).toHaveCount(0)
    await expect(page.locator('canvas')).toHaveCount(1)
    await expect(page.locator('canvas')).toBeVisible()
    expect(await canvasColours(page)).toBeGreaterThan(50)
    expect(calls.glb).toBe(0)
    expect(errors).toEqual([])
  })
}

test('opens a door on the live path with the clip Pascal would bake', async ({ page }) => {
  await mockPascal(page, () => ({
    body: sceneBody({ graph: liveGraph, bake: { status: 'none', bakeVersion: null, hash: null, lods: [] } }),
  }))
  await mockLiveAssets(page)
  await page.goto('/?project=fixture-house')
  await expect(page.locator('main[data-source="live"][data-scene-ready="true"]')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(600)
  await openRoom(page, 'Live room')
  // Named as Pascal's viewer names an unnamed door.
  const door = await findNamed(page, 'Door')
  expect(door).not.toBeNull()

  const canvas = page.locator('canvas')
  const closed = await canvas.screenshot()
  await page.mouse.click(door!.x, door!.y)
  await page.waitForTimeout(1300)
  const opened = await canvas.screenshot()
  expect(opened.equals(closed)).toBe(false)
  await page.mouse.click(door!.x, door!.y)
  await page.waitForTimeout(1300)
  expect((await canvas.screenshot()).equals(opened)).toBe(false)
})

test('polls while showing live, then switches to the ready bake', async ({ page }) => {
  test.setTimeout(60_000)
  await page.clock.install()
  const calls = await mockPascal(page, (n) => ({
    body: n === 1
      ? sceneBody({ graph: liveGraph, bake: { status: 'baking', bakeVersion: null, hash: null, lods: [] } })
      : sceneBody(),
  }))
  await mockLiveAssets(page)
  await page.goto('/?project=fixture-house')
  await expect(page.locator('main[data-source="live"][data-scene-ready="true"]')).toBeVisible({ timeout: 20_000 })
  await page.clock.fastForward(30_000)
  await expect(page.locator('main[data-source="baked"][data-scene-ready="true"]')).toBeVisible()
  expect(calls).toEqual({ scene: 2, glb: 1 })
})

test('says when the project is not published', async ({ page }) => {
  await mockPascal(page, () => ({ status: 404, body: JSON.stringify({ error: 'not_published' }) }))
  await page.goto('/?project=fixture-house')
  await expect(
    page.getByRole('heading', { name: "This project isn't published yet" }),
  ).toBeVisible()
})

const ISSUER = 'https://editor.pascal.app'
const VIEWER = 'viewer_fixture'
const PROJECT = 'fixture-house'
const STATE = 's'.repeat(43)
const VERIFIER = 'v'.repeat(43)
const CODE = `pvc_${'c'.repeat(43)}`
const TOKEN = `pvh_${'t'.repeat(43)}`
const HANDOFF_KEY = `pascal:handoff:${ISSUER}`
const origin = 'http://localhost:4179'
const redirectUri = origin + '/'
const CREDENTIAL_KEY = `pascal:credential:${JSON.stringify([ISSUER, VIEWER, PROJECT, origin])}`
const entryPath = `/?project=${PROJECT}&viewer=${VIEWER}&access=share`
const callbackPath = `/?code=${CODE}&state=${STATE}&iss=${encodeURIComponent(ISSUER)}`

async function mockDescriptor(page: Page) {
  const calls = { resolve: 0 }
  await page.route('**/api/viewers/resolve?*', (route) => {
    calls.resolve++
    expect(new URL(route.request().url()).searchParams.get('origin')).toBe(origin)
    return route.fulfill({ headers: cors, json: {
      viewer_id: VIEWER, display_name: 'Fixture viewer', entry_url: redirectUri,
      redirect_uri: redirectUri, availability: 'available',
    } })
  })
  return calls
}

async function seedTransaction(page: Page, overrides: Record<string, unknown> = {}) {
  await page.addInitScript(({ key, value, origin }) => {
    if (location.origin !== origin || sessionStorage.getItem(`fixture:seeded:${key}`)) return
    sessionStorage.setItem(key, JSON.stringify(value))
    sessionStorage.setItem(`fixture:seeded:${key}`, 'true')
  }, {
    key: HANDOFF_KEY, origin,
    value: { verifier: VERIFIER, state: STATE, issuer: ISSUER, viewer: VIEWER, project: PROJECT,
      redirect_uri: redirectUri, access: 'share', createdAt: Date.now(), returnPath: entryPath, ...overrides },
  })
}

async function seedCredential(page: Page, overrides: Record<string, unknown> = {}, key = CREDENTIAL_KEY) {
  await page.addInitScript(({ key, value, origin }) => {
    if (location.origin !== origin || sessionStorage.getItem(`fixture:seeded:${key}`)) return
    sessionStorage.setItem(key, JSON.stringify(value))
    sessionStorage.setItem(`fixture:seeded:${key}`, 'true')
  }, {
    key, origin,
    value: { access_token: TOKEN, expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      project_id: PROJECT, viewer_id: VIEWER, issuer: ISSUER, origin, access: 'share',
      renewalAttempted: false, ...overrides },
  })
}

async function mockExchange(page: Page, expiresAt = new Date(Date.now() + 3_600_000).toISOString()) {
  const calls = { exchange: 0, scrubbed: false }
  await page.route('**/api/viewer-handoff/exchange', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    calls.exchange++
    calls.scrubbed = await page.evaluate(() => !['code', 'state', 'iss'].some((key) => new URLSearchParams(location.search).has(key)))
    expect(route.request().method()).toBe('POST')
    expect(route.request().postDataJSON()).toEqual({ code: CODE, code_verifier: VERIFIER, viewer: VIEWER, redirect_uri: redirectUri })
    expect(route.request().headers()['cookie']).toBeUndefined()
    expect(route.request().headers()['authorization']).toBeUndefined()
    await route.fulfill({ headers: cors, json: { access_token: TOKEN, token_type: 'Bearer',
      expires_at: expiresAt, project_id: PROJECT, viewer_id: VIEWER, revision: 'published' } })
  })
  return calls
}

async function mockAuthorize(page: Page) {
  await page.route('**/viewer/authorize?*', (route) => route.fulfill({ contentType: 'text/html', body: '<p>Pascal authorize</p>' }))
}

test('starts the share handoff with independent state, S256 PKCE and the exact callback', async ({ page }) => {
  const reads = await mockPascal(page)
  const registry = await mockDescriptor(page)
  await mockAuthorize(page)
  await page.goto(entryPath)
  await page.waitForURL(`${ISSUER}/viewer/authorize?*`)
  const query = new URL(page.url()).searchParams
  expect([...query.keys()].sort()).toEqual(['access', 'code_challenge', 'code_challenge_method', 'project', 'redirect_uri', 'state', 'viewer'])
  expect(query.get('access')).toBe('share')
  expect(query.get('viewer')).toBe(VIEWER)
  expect(query.get('project')).toBe(PROJECT)
  expect(query.get('redirect_uri')).toBe(redirectUri)
  expect(query.get('code_challenge_method')).toBe('S256')
  expect(query.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  // Return to the viewer origin without running its app to inspect the saved transaction.
  await page.route(`${origin}/inspect`, (route) => route.fulfill({ contentType: 'text/html', body: '<p>Inspect</p>' }))
  await page.goto('/inspect')
  const transaction = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)!), HANDOFF_KEY)
  expect(transaction.state).toBe(query.get('state'))
  expect(transaction.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(transaction.verifier).not.toBe(transaction.state)
  expect(query.get('code_challenge')).toBe(createHash('sha256').update(transaction.verifier).digest('base64url'))
  expect(transaction.returnPath).toBe(entryPath)
  expect(reads.scene).toBe(0)
  expect(registry.resolve).toBe(1)
})

test('exchanges the callback once, scrubs before exchange and reads with the child bearer', async ({ page, context }) => {
  await context.addCookies([{ name: 'pascal_session', value: 'must-not-send', url: ISSUER }])
  await mockPascal(page)
  const registry = await mockDescriptor(page)
  await seedTransaction(page)
  const exchange = await mockExchange(page)
  const read = page.waitForRequest('**/api/projects/*/scene*')
  const storage = page.waitForRequest(GLB_URL)
  await page.goto(callbackPath)
  await expectBakedReady(page)
  expect((await read).headers()['authorization']).toBe(`Bearer ${TOKEN}`)
  expect((await read).headers()['cookie']).toBeUndefined()
  expect((await storage).headers()['authorization']).toBeUndefined()
  expect(exchange).toEqual({ exchange: 1, scrubbed: true })
  expect(page.url()).toBe(origin + entryPath)
  const stored = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)!), CREDENTIAL_KEY)
  expect(stored.access_token).toBe(TOKEN)
  expect(stored.access).toBe('share')
  expect(await page.evaluate(() => localStorage.length)).toBe(0)
  expect(registry.resolve).toBe(1)
  await page.reload()
  await expectBakedReady(page)
  expect(exchange.exchange).toBe(1)
  expect(registry.resolve).toBe(2)
})

for (const invalid of ['state', 'issuer', 'age', 'viewer', 'project', 'callback', 'return path', 'unsolicited', 'duplicate state']) {
  test(`refuses a callback with invalid ${invalid} without exchanging or reading`, async ({ page }) => {
    const reads = await mockPascal(page)
    await mockDescriptor(page)
    if (invalid !== 'unsolicited') await seedTransaction(page, {
      ...(invalid === 'age' ? { createdAt: Date.now() - 600_001 } : {}),
      ...(invalid === 'viewer' ? { viewer: 'viewer_other' } : {}),
      ...(invalid === 'project' ? { project: 'project_other' } : {}),
      ...(invalid === 'callback' ? { redirect_uri: origin + '/wrong' } : {}),
      ...(invalid === 'return path' ? { returnPath: '//evil.example/' } : {}),
    })
    const exchange = await mockExchange(page)
    const path = invalid === 'state' ? callbackPath.replace(STATE, 'w'.repeat(43))
      : invalid === 'issuer' ? callbackPath.replace(encodeURIComponent(ISSUER), encodeURIComponent('https://other.example'))
      : invalid === 'duplicate state' ? callbackPath + '&state=duplicate' : callbackPath
    await page.goto(path)
    await expect(page.locator('main[data-state="reopen"]')).toBeVisible()
    expect(exchange.exchange).toBe(0)
    expect(reads.scene).toBe(0)
    expect(new URL(page.url()).searchParams.has('code')).toBe(false)
    expect(new URL(page.url()).searchParams.has('state')).toBe(false)
    expect(new URL(page.url()).searchParams.has('iss')).toBe(false)
  })
}

for (const status of [401, 403]) {
  test(`clears a stored credential after a ${status} read and shows reopen without anonymous fallback`, async ({ page }) => {
    const reads = await mockPascal(page, () => ({ status, body: JSON.stringify({ error: 'unauthorized' }) }))
    await mockDescriptor(page)
    await seedCredential(page)
    await page.goto(`/?project=${PROJECT}`)
    await expect(page.getByRole('heading', { name: 'Reopen your share link' })).toBeVisible()
    expect(await page.evaluate((key) => sessionStorage.getItem(key), CREDENTIAL_KEY)).toBeNull()
    expect(reads.scene).toBe(1)
    await expect(page.getByRole('link', { name: 'Open project in Pascal' })).toHaveAttribute('href', `${ISSUER}/editor/${PROJECT}`)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Reopen your share link' })).toBeVisible()
    expect(reads.scene).toBe(1)
  })
}

test('renews a credential near expiry with its original session mode', async ({ page }) => {
  const reads = await mockPascal(page)
  await mockDescriptor(page)
  await seedCredential(page, { expires_at: new Date(Date.now() + 90_000).toISOString(), access: 'session' })
  await mockAuthorize(page)
  await page.goto(`/?project=${PROJECT}`)
  await page.waitForURL(`${ISSUER}/viewer/authorize?*`)
  expect(new URL(page.url()).searchParams.get('access')).toBe('session')
  expect(new URL(page.url()).searchParams.get('interaction')).toBe('sign_in')
  expect(reads.scene).toBe(0)
})

test('stops a renewal loop when the renewed credential is already near expiry', async ({ page }) => {
  const reads = await mockPascal(page)
  await mockDescriptor(page)
  await seedTransaction(page, { renewal: true })
  const exchange = await mockExchange(page, new Date(Date.now() + 90_000).toISOString())
  await page.goto(callbackPath)
  await expect(page.getByRole('heading', { name: 'Reopen your share link' })).toBeVisible()
  expect(exchange.exchange).toBe(1)
  expect(reads.scene).toBe(0)
  expect(await page.evaluate((key) => sessionStorage.getItem(key), CREDENTIAL_KEY)).toBeNull()
})

test('ignores credentials stored for another project and reads public projects anonymously', async ({ page }) => {
  await mockPascal(page)
  await mockDescriptor(page)
  await seedCredential(page, { project_id: 'another-project' }, `pascal:credential:${JSON.stringify([ISSUER, VIEWER, 'another-project', origin])}`)
  const read = page.waitForRequest('**/api/projects/*/scene*')
  await page.goto(`/?project=${PROJECT}`)
  await expectBakedReady(page)
  expect((await read).headers()['authorization']).toBeUndefined()
})
