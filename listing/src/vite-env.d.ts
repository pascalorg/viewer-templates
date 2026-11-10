/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PASCAL_BASE_URL?: string
  readonly VITE_PASCAL_PROJECT_ID?: string
  readonly VITE_PASCAL_TOKEN_URL?: string
  /** Read by vite.config.ts for the Content-Security-Policy only. */
  readonly VITE_PASCAL_ASSET_ORIGINS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
