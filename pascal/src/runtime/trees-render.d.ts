// Compiler-only: Vite bundles the real render entry, without aliasing or patching it.
// The pinned trees sources expect Next-shaped thumbnails; Vite types images as strings.
import type { Plugin } from '@pascal-app/core'
export const treesRenderPlugin: Plugin
