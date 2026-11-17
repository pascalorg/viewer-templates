/**
 * The X-ray families as the chrome presents them: a label and an icon per family of the viewer's
 * `VIEWER_FAMILIES`. Pure, so the choice of the opening family is unit-tested.
 */

export const FAMILY_LABELS: Record<string, string> = {
  site: 'Site',
  floors: 'Floors',
  walls: 'Walls',
  structure: 'Structure',
  circulation: 'Stairs and lifts',
  openings: 'Doors and windows',
  roofs: 'Roofs',
  'roof-services': 'Roof fittings',
  hvac: 'Heating and cooling',
  plumbing: 'Plumbing',
  items: 'Furniture and items',
  other: 'Other',
}

export const familyLabel = (family: string) => FAMILY_LABELS[family] ?? family.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** X-ray opens on the shell of the house: walls, else structure, else floors, else the first. */
export function firstXrayFamily(families: readonly string[]): string | null {
  return ['walls', 'structure', 'floors'].find((family) => families.includes(family)) ?? families[0] ?? null
}
