import {
  type AuthData,
  Auth,
  callService,
  type Connection,
  createConnection,
  ERR_CANNOT_CONNECT,
  ERR_INVALID_AUTH,
  genExpires,
  getAuth,
  subscribeEntities,
} from 'home-assistant-js-websocket'
import { create } from 'zustand'
import type { HassEntities } from '../entities'
import { takeHassCallback } from './callback'

/* The viewer's connection to the visitor's own Home Assistant: its sign-in (Home Assistant's own
   login page, which hands back a key), the live states of every entity, and the area each one is
   in. The key stays in this tab's sessionStorage, as the Pascal credentials do; the address is
   remembered (it is not a secret) so the next visit only asks to sign in again. */

const URL_KEY = 'pascal-ha-url'
const TOKENS_KEY = 'pascal-ha-auth'
/** The address a sign-in was started for: a sign-in coming back for any other is refused. */
const PENDING_KEY = 'pascal-ha-pending'

export type HassStatus = 'idle' | 'redirecting' | 'connecting' | 'connected' | 'error'

export type EntityRegistryOptions = {
  sensor?: { display_precision?: number | null }
  light?: { favorite_colors?: unknown[] }
  cover?: { favorite_positions?: number[]; favorite_tilt_positions?: number[] }
  valve?: { favorite_positions?: number[] }
}

/** Per-entity metadata from Home Assistant's entity registry, used to resolve translations, icons and sibling device entities. */
export type EntityRegistryInfo = {
  platform: string
  translation_key?: string | null
  display_precision?: number | null
  device_id?: string | null
  icon?: string | null
  options?: EntityRegistryOptions
}

export type UnitSystem = {
  temperature: string
  length: string
  pressure: string
  wind_speed: string
  accumulated_precipitation: string
}

export const DEFAULT_UNIT_SYSTEM: UnitSystem = {
  temperature: '°C',
  length: 'km',
  pressure: 'hPa',
  wind_speed: 'km/h',
  accumulated_precipitation: 'mm',
}

/** Icon translation entry shape returned by Home Assistant's `frontend/get_icons`. */
export type IconTranslationEntry = {
  default?: string
  state?: Record<string, string>
  range?: Record<string, string>
  state_attributes?: Record<string, { default?: string; state?: Record<string, string>; range?: Record<string, string> }>
}

export type HassIcons = {
  /** `component[domain][device_class_or__]` */
  entity_component: Record<string, Record<string, IconTranslationEntry>>
  /** `entity[platform][domain][translation_key]` */
  entity: Record<string, Record<string, Record<string, IconTranslationEntry>>>
}

const EMPTY_ICONS: HassIcons = { entity_component: {}, entity: {} }

type HassState = {
  status: HassStatus
  /** The address last used, to fill in the form. */
  hassUrl: string
  /** What went wrong, in words a visitor can act on. */
  error: string | null
  entities: HassEntities
  /** Each entity's area name, from Home Assistant's registries (its own, else its device's). */
  areaOf: Record<string, string>
  /** Each entity's platform and translation key, from Home Assistant's entity registry. */
  registryOf: Record<string, EntityRegistryInfo>
  /** Home Assistant's configured language (e.g. 'en'), temperature unit ('°C' or '°F') and full unit system. */
  language: string
  temperatureUnit: string
  unitSystem: UnitSystem
  /** Flat dotted translation map from `frontend/get_translations` (entity_component + entity). */
  translations: Record<string, string>
  /** Icon maps from `frontend/get_icons` (entity_component + entity). */
  icons: HassIcons
  connection: Connection | null
  /** Picks up a sign-in that just came back, or this tab's key; does nothing without either. */
  resume: () => Promise<void>
  /** Sends the visitor to their Home Assistant's login page. */
  signIn: (address: string) => Promise<void>
  disconnect: () => void
  call: (domain: string, service: string, data: Record<string, unknown>) => Promise<boolean>
}

/** "myhome.duckdns.org:8123/" → "https://myhome.duckdns.org:8123". */
export function normalizeAddress(address: string): string {
  let a = address.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(a)) a = `${location.protocol === 'https:' ? 'https' : 'http'}://${a}`
  const url = new URL(a)
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`
}

const saveTokens = (data: AuthData | null) => {
  if (data) sessionStorage.setItem(TOKENS_KEY, JSON.stringify(data))
  else sessionStorage.removeItem(TOKENS_KEY)
}
const loadTokens = (): AuthData | null => {
  try {
    return JSON.parse(sessionStorage.getItem(TOKENS_KEY) ?? 'null') as AuthData | null
  } catch {
    return null
  }
}

/** Why a connection failed, said so a visitor knows what to change. */
function explain(failure: unknown, hassUrl: string): string {
  const origin = location.origin
  if (failure === ERR_INVALID_AUTH) return 'Home Assistant refused the sign-in. Connect again to sign in afresh.'
  if (failure === ERR_CANNOT_CONNECT) return `Could not reach ${hassUrl}. Check the address, and that it opens in this browser.`
  if (failure instanceof TypeError) {
    // a fetch the browser blocked or could not make: the address is wrong, or Home Assistant
    // does not allow this site (the browser does not say which)
    return `Could not reach ${hassUrl} from this page. Check it opens in this browser, and that your configuration.yaml has ${origin} under http: cors_allowed_origins (then restart Home Assistant).`
  }
  return failure instanceof Error ? failure.message : 'Connecting to Home Assistant failed.'
}

/** Trades the code a sign-in came back with for a key (Home Assistant's token request). */
async function finishSignIn(code: string, state: string): Promise<AuthData> {
  const decoded = JSON.parse(atob(state)) as { hassUrl: string; clientId: string | null; nonce?: string }
  const pending = sessionStorage.getItem(PENDING_KEY)
  sessionStorage.removeItem(PENDING_KEY)
  if (!pending || decoded.hassUrl !== pending) throw new Error('That sign-in was not started here. Connect again.')
  let verifier: string | undefined
  if (decoded.nonce) {
    const key = `hass_oauth_state_${decoded.nonce}`
    const stored = JSON.parse(sessionStorage.getItem(key) ?? 'null') as { codeVerifier: string; state: string } | null
    sessionStorage.removeItem(key)
    if (stored?.state !== state) throw new Error('That sign-in was not started here. Connect again.')
    verifier = stored.codeVerifier
  }
  const body = new URLSearchParams({ grant_type: 'authorization_code', code })
  if (decoded.clientId) body.set('client_id', decoded.clientId)
  if (verifier) body.set('code_verifier', verifier)
  const res = await fetch(`${decoded.hassUrl}/auth/token`, { method: 'POST', credentials: 'same-origin', body })
  if (!res.ok) throw new Error(`Home Assistant refused the sign-in (${res.status}). Connect again.`)
  const tokens = (await res.json()) as Omit<AuthData, 'hassUrl' | 'clientId' | 'expires'>
  return { ...tokens, hassUrl: decoded.hassUrl, clientId: decoded.clientId, expires: genExpires(tokens.expires_in) }
}

type Registry = {
  areas: { area_id: string; name: string }[]
  devices: { id: string; area_id: string | null }[]
  entities: {
    entity_id: string
    area_id: string | null
    device_id: string | null
    platform?: string
    translation_key?: string | null
    icon?: string | null
    options?: EntityRegistryOptions
  }[]
}

async function readRegistry(connection: Connection): Promise<{
  areaOf: Record<string, string>
  registryOf: Record<string, EntityRegistryInfo>
}> {
  const [areas, devices, entities] = await Promise.all([
    connection.sendMessagePromise<Registry['areas']>({ type: 'config/area_registry/list' }),
    connection.sendMessagePromise<Registry['devices']>({ type: 'config/device_registry/list' }),
    connection.sendMessagePromise<Registry['entities']>({ type: 'config/entity_registry/list' }),
  ])
  const areaName = new Map(areas.map((a) => [a.area_id, a.name]))
  const deviceArea = new Map(devices.map((d) => [d.id, d.area_id]))
  const areaOf: Record<string, string> = {}
  const registryOf: Record<string, EntityRegistryInfo> = {}
  for (const e of entities) {
    const id = e.area_id ?? (e.device_id ? deviceArea.get(e.device_id) : null)
    const name = id ? areaName.get(id) : undefined
    if (name) areaOf[e.entity_id] = name
    if (e.platform || e.device_id || e.icon || e.options) {
      registryOf[e.entity_id] = {
        platform: e.platform ?? '',
        translation_key: e.translation_key ?? null,
        display_precision: e.options?.sensor?.display_precision ?? null,
        device_id: e.device_id ?? null,
        icon: e.icon ?? null,
        options: e.options,
      }
    }
  }
  return { areaOf, registryOf }
}

type HassConfigResponse = {
  language?: string
  unit_system?: Partial<UnitSystem>
  components?: string[]
}

function platformsForTranslations(registryOf: Record<string, EntityRegistryInfo>): string[] {
  const set = new Set<string>()
  for (const info of Object.values(registryOf)) {
    if (info.translation_key && info.platform) set.add(info.platform)
  }
  return [...set].sort()
}

async function readConfig(connection: Connection): Promise<{
  language: string
  temperatureUnit: string
  unitSystem: UnitSystem
}> {
  try {
    const cfg = await connection.sendMessagePromise<HassConfigResponse>({ type: 'get_config' })
    const unitSystem: UnitSystem = {
      temperature: cfg.unit_system?.temperature || DEFAULT_UNIT_SYSTEM.temperature,
      length: cfg.unit_system?.length || DEFAULT_UNIT_SYSTEM.length,
      pressure: cfg.unit_system?.pressure || DEFAULT_UNIT_SYSTEM.pressure,
      wind_speed: cfg.unit_system?.wind_speed || DEFAULT_UNIT_SYSTEM.wind_speed,
      accumulated_precipitation:
        cfg.unit_system?.accumulated_precipitation || DEFAULT_UNIT_SYSTEM.accumulated_precipitation,
    }
    return {
      language: cfg.language || 'en',
      temperatureUnit: unitSystem.temperature,
      unitSystem,
    }
  } catch {
    return { language: 'en', temperatureUnit: DEFAULT_UNIT_SYSTEM.temperature, unitSystem: DEFAULT_UNIT_SYSTEM }
  }
}

async function readTranslations(
  connection: Connection,
  language: string,
  platforms: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  try {
    const comp = await connection.sendMessagePromise<{ resources?: Record<string, string> }>({
      type: 'frontend/get_translations',
      language,
      category: 'entity_component',
    })
    if (comp?.resources) Object.assign(out, comp.resources)
  } catch {
    // Fall back to bundled English strings.
  }
  if (platforms.length > 0) {
    try {
      const ent = await connection.sendMessagePromise<{ resources?: Record<string, string> }>({
        type: 'frontend/get_translations',
        language,
        category: 'entity',
        integration: platforms,
      })
      if (ent?.resources) Object.assign(out, ent.resources)
    } catch {
      // Fall back to entity_component / bundled English strings.
    }
  }
  return out
}

async function readIcons(connection: Connection, platforms: string[]): Promise<HassIcons> {
  const entity_component: HassIcons['entity_component'] = {}
  const entity: HassIcons['entity'] = {}
  try {
    const comp = await connection.sendMessagePromise<{
      resources?: Record<string, Record<string, IconTranslationEntry>>
    }>({
      type: 'frontend/get_icons',
      category: 'entity_component',
    })
    if (comp?.resources) Object.assign(entity_component, comp.resources)
  } catch {
    // Fall back to static named-import icon table.
  }
  await Promise.all(
    platforms.map(async (platform) => {
      try {
        const res = await connection.sendMessagePromise<{
          resources?: Record<string, Record<string, Record<string, IconTranslationEntry>>>
        }>({
          type: 'frontend/get_icons',
          category: 'entity',
          integration: platform,
        })
        const platformIcons = res?.resources?.[platform]
        if (platformIcons) entity[platform] = platformIcons
      } catch {
        // Ignore missing platform icons; static fallback applies.
      }
    }),
  )
  return { entity_component, entity }
}

let resuming: Promise<void> | null = null
let unsubscribe: (() => void) | null = null

export const useHass = create<HassState>((set, get) => {
  const open = async (auth: Auth) => {
    set({ status: 'connecting', error: null, hassUrl: auth.data.hassUrl })
    try {
      const connection = await createConnection({ auth })
      const [{ areaOf, registryOf }, { language, temperatureUnit, unitSystem }] = await Promise.all([
        readRegistry(connection),
        readConfig(connection),
      ])
      const initialPlatforms = platformsForTranslations(registryOf)
      let loadedPlatformKey = initialPlatforms.join(',')
      const [translations, icons] = await Promise.all([
        readTranslations(connection, language, initialPlatforms),
        readIcons(connection, initialPlatforms),
      ])
      unsubscribe?.()
      unsubscribe = subscribeEntities(connection, (entities) => set({ entities: entities as unknown as HassEntities }))
      // rooms and entity registry metadata change while the plan is open: read them again, once a burst settles
      let pending = 0
      const reread = () => {
        window.clearTimeout(pending)
        pending = window.setTimeout(() => {
          void readRegistry(connection)
            .then(async ({ areaOf: a, registryOf: r }) => {
              set({ areaOf: a, registryOf: r })
              const nextPlatforms = platformsForTranslations(r)
              const nextKey = nextPlatforms.join(',')
              const lang = get().language
              if (nextKey !== loadedPlatformKey) {
                loadedPlatformKey = nextKey
                const [nextTranslations, nextIcons] = await Promise.all([
                  readTranslations(connection, lang, nextPlatforms),
                  readIcons(connection, nextPlatforms),
                ])
                set({ translations: nextTranslations, icons: nextIcons })
              }
            })
            .catch(() => {
              // Registry reread failed; keep existing data rather than breaking the connection.
            })
        }, 400)
      }
      connection.addEventListener('ready', reread)
      for (const event of ['area_registry_updated', 'device_registry_updated', 'entity_registry_updated']) {
        void connection.subscribeEvents(reread, event)
      }
      set({
        status: 'connected',
        connection,
        areaOf,
        registryOf,
        language,
        temperatureUnit,
        unitSystem,
        translations,
        icons,
      })
    } catch (failure) {
      if (failure === ERR_INVALID_AUTH) saveTokens(null)
      set({ status: 'error', error: explain(failure, auth.data.hassUrl), connection: null })
    }
  }

  return {
    status: 'idle',
    hassUrl: localStorage.getItem(URL_KEY) ?? '',
    error: null,
    entities: {},
    areaOf: {},
    registryOf: {},
    language: 'en',
    temperatureUnit: DEFAULT_UNIT_SYSTEM.temperature,
    unitSystem: DEFAULT_UNIT_SYSTEM,
    translations: {},
    icons: EMPTY_ICONS,
    connection: null,

    resume: () => {
      resuming ??= (async () => {
        const back = takeHassCallback()
        if (back) {
          set({ status: 'connecting', error: null })
          try {
            const data = await finishSignIn(back.code, back.state)
            saveTokens(data)
            await open(new Auth(data, saveTokens))
          } catch (failure) {
            set({ status: 'error', error: explain(failure, sessionStorage.getItem(PENDING_KEY) ?? get().hassUrl) })
          }
          return
        }
        const saved = loadTokens()
        if (saved) await open(new Auth(saved, saveTokens))
      })()
      return resuming
    },

    signIn: async (address) => {
      let hassUrl: string
      try {
        hassUrl = normalizeAddress(address)
      } catch {
        set({ status: 'error', error: 'That is not an address. Try something like https://myhome.duckdns.org' })
        return
      }
      if (location.protocol === 'https:' && hassUrl.startsWith('http:')) {
        set({ status: 'error', error: 'This viewer is on https, so your Home Assistant must be too (a browser will not mix them).' })
        return
      }
      localStorage.setItem(URL_KEY, hassUrl)
      sessionStorage.setItem(PENDING_KEY, hassUrl)
      saveTokens(null)
      set({ status: 'redirecting', error: null, hassUrl })
      // no key stored: the library sends the page to Home Assistant's login, and comes back here
      await getAuth({ hassUrl, loadTokens: async () => null, saveTokens }).catch((failure: unknown) =>
        set({ status: 'error', error: explain(failure, hassUrl) }))
    },

    disconnect: () => {
      unsubscribe?.()
      unsubscribe = null
      get().connection?.close()
      saveTokens(null)
      resuming = null
      set({
        status: 'idle',
        connection: null,
        entities: {},
        areaOf: {},
        registryOf: {},
        language: 'en',
        temperatureUnit: DEFAULT_UNIT_SYSTEM.temperature,
        unitSystem: DEFAULT_UNIT_SYSTEM,
        translations: {},
        icons: EMPTY_ICONS,
        error: null,
      })
    },

    call: async (domain, service, data) => {
      const connection = get().connection
      if (!connection) return false
      try {
        await callService(connection, domain, service, data)
        return true
      } catch (failure: unknown) {
        // Home Assistant answers a failed call with { code, message }, not an Error
        set({ error: (failure as { message?: string } | null)?.message ?? `${domain}.${service} failed` })
        return false
      }
    },
  }
})
