import { MATERIAL_CATEGORIES, MaterialPresetPayloadSchema, registerLibraryMaterials, type MaterialCatalogItem, type MaterialCategory } from '@pascal-app/core'
import { z } from 'zod'

const materialRow = z.object({
  id: z.string(), name: z.string(), category: z.string().nullable().optional(),
  thumbnailUrl: z.string().nullable().optional(), preset: MaterialPresetPayloadSchema,
})

/** Public scene rows use name/thumbnailUrl; the runtime catalog uses label/previewThumbnailUrl. */
export function registerReferencedLibraryMaterials(materials: readonly unknown[]): void {
  if (materials.length === 0) return
  const items: MaterialCatalogItem[] = materials.map((value) => {
    const row = materialRow.parse(value)
    return {
      id: row.id, label: row.name, source: 'community', preset: row.preset,
      category: (MATERIAL_CATEGORIES as readonly string[]).includes(row.category ?? '')
        ? row.category as MaterialCategory : 'other',
      previewThumbnailUrl: row.thumbnailUrl ?? undefined,
    }
  })
  registerLibraryMaterials(items)
}
