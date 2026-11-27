import { useViewer } from '@pascal-app/viewer'
import { Button, Popover, PopoverContent, PopoverTrigger, type ViewerSource } from '@pascal-app/viewer/ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { type Area, domainOf, type FieldKind, type HomeDevice } from './entities'
import { useHass } from './hass/connection'
import { HomeEffects, type PinRefs } from './HomeEffects'
import { HomePanel } from './HomePanel'
import { anchorOf, type EntityInfo, entityInfos, type Link, linkHome, type LinkReport, wantsOf } from './link/match'
import { formatReport } from './link/report'
import { type GraphNodes, polygonOf, readThings, type Room, type Thing } from './link/scene'
import { HomeNoir } from './sketch/HomeNoir'
import { homeOf, linkOf, pickOf, readStore, ROOM_PICK, updateStore } from './storage'

/* Home Assistant on a Pascal project: the visitor connects their own Home Assistant, its entities
   are linked to the plan's items (src/home/link), and the linked items get their effects, pins and
   controls while the rest of the plan is drawn as the guided tour's wireframe. Links the matching
   could not settle are put to the visitor; their answers are kept in this browser, per project. */

const FLOOR_Y = 0.05

/** Things that control a device elsewhere: they get a pin and controls, never the device's effect
    (a wall thermostat blows no air). */
const QUIET_KINDS: ReadonlySet<string> = new Set(['thermostat', 'keypad', 'plug', 'sensor', 'other'])

/** What the plan leaves out, as the lab has none: the ceilings over every room (the fans and lights
    hung from them still draw), and the editor's start marker. */
const HIDDEN_KINDS: ReadonlySet<string> = new Set(['ceiling', 'ceiling-grid', 'spawn'])

/**
 * Answers the visitor gave, kept in this browser per project and Home Assistant, in the viewer's one
 * stored document (`storage.ts`): links (entity → item id, `room:` and a room id, or null for off the
 * plan) or areas (Home Assistant area → room id, or null for none of the plan's).
 */
function useAnswers(kind: 'links' | 'areas', projectId: string, hassUrl: string) {
  const read = useCallback((): Record<string, string | null> => {
    const home = readStore().projects[projectId]?.homes[hassUrl]
    if (!home) return {}
    return kind === 'links'
      ? Object.fromEntries(Object.entries(home.links).map(([id, link]) => [id, pickOf(link)]))
      : Object.fromEntries(Object.entries(home.areas).map(([area, a]) => [area, a.roomId]))
  }, [kind, projectId, hassUrl])
  const [answers, setAnswers] = useState<Record<string, string | null>>(read)
  useEffect(() => setAnswers(read()), [read])
  const write = useCallback((name: string, value: string | null | undefined) => {
    const now = new Date().toISOString()
    updateStore((store) => {
      const home = homeOf(store, projectId, hassUrl)
      const into = kind === 'links' ? home.links : home.areas
      if (value === undefined) delete into[name]
      else if (kind === 'links') home.links[name] = linkOf(value, now)
      else home.areas[name] = { roomId: value, updatedAt: now }
      home.updatedAt = now
    })
    setAnswers(read())
  }, [kind, projectId, hassUrl, read])
  const answer = useCallback((name: string, value: string | null) => write(name, value), [write])
  const forget = useCallback((name: string) => write(name, undefined), [write])
  return { answers, answer, forget }
}

/** A link to a room itself, not to a thing in it (a humidity sensor reads its room). */
const roomOfPick = (pick: string) => (pick.startsWith(ROOM_PICK) ? pick.slice(ROOM_PICK.length) : null)

/** The visitor's links over the matching's: entity → the thing it drives, or null for none. A
    link made by hand takes the thing from whatever the matching had put there in its domain. */
function withPicks(report: LinkReport, picks: Record<string, string | null>): Link[] {
  const handled = new Set(Object.entries(picks).flatMap(([id, thing]) => (thing && !roomOfPick(thing) ? [`${thing}|${domainOf(id)}`] : [])))
  return report.links.map((l): Link => {
    if (l.entityId in picks) {
      const pick = picks[l.entityId]
      const room = pick ? roomOfPick(pick) : null
      if (room) return { ...l, status: 'room', thingId: undefined, roomId: room, why: 'you put it in the room' }
      return pick
        ? { ...l, status: 'sure', thingId: pick, why: 'you linked it' }
        : { ...l, status: 'missing', thingId: undefined, why: 'you unlinked it' }
    }
    if (l.thingId && handled.has(`${l.thingId}|${domainOf(l.entityId)}`)) {
      return { ...l, status: 'unplaced', thingId: undefined, why: 'you linked another device to its thing' }
    }
    return l
  })
}

/** A room's floor rectangle, for the room readings. */
function areasOf(nodes: GraphNodes): Area[] {
  return Object.values(nodes).flatMap((n) => {
    if (n?.type !== 'zone') return []
    const poly = polygonOf(n)
    if (!poly.length) return []
    const xs = poly.map((p) => p[0])
    const zs = poly.map((p) => p[1])
    return [{ id: n.id, name: n.name ?? n.id, bounds: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] as Area['bounds'] }]
  })
}

/** Where a thing is drawn: the middle of its drawn model, else where the graph puts it. */
function drawnCentre(source: ViewerSource, t: Thing): [number, number, number] {
  const object = source.objectFor(t.id)
  if (!object) return t.position
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) return t.position
  const c = box.getCenter(new THREE.Vector3())
  return [c.x, c.y, c.z]
}

/** A question the linking leaves to the visitor: which room an area is, or which thing an entity drives. */
export type Question =
  | { kind: 'area'; area: string; choices: Room[]; devices: number }
  | { kind: 'entity'; link: Link }

export type HomeLayer = ReturnType<typeof useHomeLayer>

/**
 * Everything the project viewer needs to put Home Assistant on its plan.
 * @param ready the scene is drawn, so drawn positions can be read
 */
export function useHomeLayer({ projectId, source, ready }: { projectId: string; source: ViewerSource; ready: boolean }) {
  const status = useHass((s) => s.status)
  const entities = useHass((s) => s.entities)
  const areaOf = useHass((s) => s.areaOf)
  const hassUrl = useHass((s) => s.hassUrl)
  useEffect(() => {
    void useHass.getState().resume()
    // development builds only: the connection's store on `window.__hass`, for debugging
    if (import.meta.env.DEV) (window as unknown as { __hass: unknown }).__hass = useHass
  }, [])
  // the visitor's links, entity → item, made on an item of a picked room (the link card); kept here
  // across visits, per project and Home Assistant
  const linkAnswers = useAnswers('links', projectId, hassUrl)
  const roomAnswers = useAnswers('areas', projectId, hassUrl)
  const picks = linkAnswers.answers

  const nodes = source.nodes as unknown as GraphNodes
  // items linked by hand are read even where the word table finds no device in them
  const include = useMemo(() => new Set(Object.values(picks).flatMap((t) => (t && !roomOfPick(t) ? [t] : []))), [picks])
  const plan = useMemo(() => readThings(nodes, { include }), [nodes, include])
  const areas = useMemo(() => areasOf(nodes), [nodes])
  // which entities there are and where, not their states: the links stay put as states change. Only
  // what Home Assistant has now is linked: never an unavailable device (offline or gone) or one it
  // only keeps an entry for (`restored`), unless the visitor linked it, so it can still be unlinked
  const entityKey = useMemo(
    () => Object.entries(entities)
      .filter(([id, e]) => (e.state !== 'unavailable' && !e.attributes.restored) || id in picks)
      .map(([id]) => id)
      .sort()
      .join(','),
    [entities, picks],
  )
  const infos = useMemo(() => {
    const all = useHass.getState().entities
    const here = Object.fromEntries(entityKey.split(',').flatMap((id) => (all[id] ? [[id, all[id]]] : [])))
    return entityInfos(here, (id) => areaOf[id])
  }, [entityKey, areaOf])
  const report = useMemo(() => linkHome(plan.things, infos, plan.rooms, roomAnswers.answers), [plan, infos, roomAnswers.answers])
  const links = useMemo(() => withPicks(report, picks), [report, picks])

  const devices = useMemo<HomeDevice[]>(() => {
    if (!ready) return []
    const byId = new Map(plan.things.map((t) => [t.id, t]))
    const areaById = new Map(areas.map((a) => [a.id, a]))
    return links.flatMap((l): HomeDevice[] => {
      const t = l.thingId ? byId.get(l.thingId) : undefined
      if (t) {
        const anchor = anchorOf(t, l.roomId ?? t.rooms[0]?.id ?? 'home')
        return [{ entityId: l.entityId, nodeId: t.id, anchor: { ...anchor, position: drawnCentre(source, t) }, ...(QUIET_KINDS.has(t.kind) ? { effect: 'none' as const } : t.type === 'door' || t.type === 'window' ? { effect: 'model' as const } : {}) }]
      }
      // what reads its room (a thermometer): a pin in the room. A device the plan does not draw stays
      // off the plan (the panel's Home tab), never an effect in mid-air
      const area = l.roomId ? areaById.get(l.roomId) : undefined
      if (!area || l.status !== 'room') return []
      const [x0, z0, x1, z1] = area.bounds
      return [{ entityId: l.entityId, anchor: { position: [(x0 + x1) / 2, 1.5, (z0 + z1) / 2], rotationY: 0, mount: 'wall', area: area.id } }]
    })
  }, [ready, links, plan, areas, source])

  const kept = useMemo(() => new Set(devices.flatMap((d) => (d.nodeId ? [d.nodeId] : []))), [devices])

  // what can be offered to link: a device Home Assistant has now, never one it lists as unavailable
  // (offline or gone) or only keeps an entry for (`restored`: removed, or its integration not loaded)
  const isAvailable = useCallback((entityId: string) => {
    const e = entities[entityId]
    return !!e && e.state !== 'unavailable' && !e.attributes.restored
  }, [entities])

  const entitiesInRoom = useCallback((roomId: string) => {
    const roomsOf = new Map(plan.things.map((t) => [t.id, t.rooms]))
    return links
      .filter((l) => l.status !== 'home' && (l.roomId === roomId || (l.thingId && roomsOf.get(l.thingId)?.some((r) => r.id === roomId))))
      .map((l) => l.entityId)
  }, [links, plan.things])

  // development builds only: the linking on `window.__homeLinks()`, printed as the test prints it
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const found = new Set(plan.things.map((t) => t.id))
    // and the items it found nothing in, with what their catalog calls them, to grow the word table
    const others = Object.values(nodes).flatMap((n) =>
      n?.type === 'item' && !found.has(n.id) ? [`${n.name || n.asset?.name} · ${n.asset?.category ?? ''}${n.asset?.attachTo ? ` · ${n.asset.attachTo}` : ''}`] : [])
    ;(window as unknown as { __homeLinks: () => void }).__homeLinks = () =>
      console.log(formatReport({ ...report, links }, plan.things), { things: plan.things, links, others })
  }, [report, links, plan, nodes])

  // the questions: rooms first (one answer can place several devices), then single devices
  const questions = useMemo<Question[]>(() => {
    const placeable = new Set(links.filter((l) => l.status !== 'home').map((l) => l.entityId))
    const count = (area: string) => infos.filter((e) => e.area === area && placeable.has(e.entity_id)).length
    const rooms = report.areas
      .filter((a) => (a.how === 'unsure' || a.how === 'none') && count(a.area) > 0)
      .map((a): Question => ({ kind: 'area', area: a.area, choices: a.choices, devices: count(a.area) }))
    return [...rooms, ...links.filter((l) => l.status === 'ask').map((link): Question => ({ kind: 'entity', link }))]
  }, [report, links, infos])

  return {
    status, connected: status === 'connected', entities, devices, areas, kept, links, questions, infos, things: plan.things, rooms: plan.rooms, source,
    /** Links an entity to a thing by hand, or to nothing. */
    pick: linkAnswers.answer,
    /** Takes back a hand-made link: the matching decides again. */
    unpick: linkAnswers.forget,
    /** Says which room a Home Assistant area is, or null for none of the plan's. */
    placeArea: roomAnswers.answer,
    /** The entities of a room: its Home Assistant area's, and those linked to its items. */
    entitiesInRoom,
    /** Whether a device is there to link: Home Assistant has it and it is not unavailable. */
    isAvailable,
  }
}

/** Inside the viewer's canvas: the wireframe over all but the linked items and the picked room, and their effects. */
export function HomeScene({ home, pins, selected, layer, onPress, room = null }: {
  home: HomeLayer
  pins: PinRefs
  selected: string | null
  layer: FieldKind | null
  onPress: (entityId: string) => void
  /** The room picked in the explore panel: it develops into its own colours. */
  room?: string | null
}) {
  return (
    <>
      <HomeNoir hide={HIDDEN_KINDS} keep={home.kept} room={room} source={home.source} />
      {home.connected && <HomeEffects devices={home.devices} areas={home.areas} entities={home.entities} layer={layer} floorY={FLOOR_Y} pins={pins} selected={selected} onPress={onPress} />}
    </>
  )
}

/** Over the viewer: the connect button, the devices panel, and the questions the linking left. */
export function HomeOverlay({ home, title, owner = null, pins, selected, layer, onSelect, onLayer, onGroup, itemId = null, onCloseItem, roomId = null }: {
  home: HomeLayer
  title: string
  /** Who made the project in Pascal. */
  owner?: string | null
  pins: PinRefs
  selected: string | null
  layer: FieldKind | null
  onSelect: (entityId: string | null) => void
  onLayer: (layer: FieldKind | null) => void
  /** A grouped pin was clicked: the devices under it, for the camera to zoom in on. */
  onGroup?: (entityIds: string[]) => void
  /** An item clicked on the plan, whose links the link card shows. */
  itemId?: string | null
  onCloseItem?: () => void
  /** The room the item was picked in: the card lists every device of it. */
  roomId?: string | null
}) {
  const call = useHass((s) => s.call)
  return (
    <>
      {/* the project and its author on the left: in the devices panel once connected, on their own before */}
      {!home.connected && (
        <div className="pointer-events-auto absolute top-4 left-4 z-30 grid max-w-[min(20rem,calc(100vw-2rem))] gap-1 rounded-2xl border border-border/60 bg-background/90 px-4 py-3 shadow-lg backdrop-blur">
          <b className="font-semibold leading-snug">{title}</b>
          {owner && <span className="truncate font-mono text-[10px] text-muted-foreground">By {owner}</span>}
        </div>
      )}
      {home.connected && (
        <HomePanel owner={owner} title={title} devices={home.devices} areas={home.areas} entities={home.entities} selected={selected} lastCall={null} notice={null}
          layer={layer} pins={pins} onSelect={onSelect} call={(d, s, data) => call(d, s, data)} onLayer={onLayer} {...(onGroup ? { onGroup } : {})} />
      )}
      <ConnectCard home={home} />
      {/* the cards sit where a device's controls open, so not while one is open */}
      {home.connected && !selected && itemId && (
        <LinkCard home={home} itemId={itemId} key={itemId} onClose={() => onCloseItem?.()} roomId={roomId} />
      )}
      {home.connected && !selected && !itemId && roomId && <RoomCard home={home} key={roomId} onSelect={onSelect} roomId={roomId} />}
      {home.connected && !selected && !itemId && !roomId && home.questions.length > 0 && <QuestionCard home={home} />}
    </>
  )
}

function ConnectCard({ home }: { home: HomeLayer }) {
  const { status, error, hassUrl, signIn, disconnect } = useHass()
  const [address, setAddress] = useState(hassUrl)
  useEffect(() => setAddress(hassUrl), [hassUrl])
  const busy = status === 'redirecting' || status === 'connecting'
  const linked = home.links.filter((l) => l.thingId).length

  if (home.connected) {
    return (
      <div className="pointer-events-auto absolute bottom-4 left-4 z-30 flex items-center gap-2 rounded-full border border-border/60 bg-background/95 py-1.5 pr-1.5 pl-4 text-sm shadow-lg backdrop-blur">
        <i className="size-2 rounded-full bg-[#3ddc97]" />
        <span className="text-muted-foreground">Home Assistant</span>
        <b className="font-medium">{linked} linked</b>
        <DisconnectButton onDisconnect={disconnect} />
      </div>
    )
  }
  return (
    // in the middle of the view until connected: the one thing to do first
    <div className="pointer-events-auto absolute top-1/2 left-1/2 z-30 w-[min(20rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2">
      <form
          className="grid gap-3 rounded-2xl border border-border/60 bg-background/95 p-4 text-sm shadow-lg backdrop-blur"
          onSubmit={(ev) => {
            ev.preventDefault()
            void signIn(address)
          }}
        >
          <div className="grid gap-1">
            <b className="font-medium">Connect Home Assistant</b>
            <span className="text-muted-foreground text-xs">Your Home Assistant's address, as you open it in this browser. You sign in on its own page.</span>
          </div>
          <input
            aria-label="Home Assistant address"
            className="h-9 rounded-full border border-border bg-background px-3.5 outline-none focus:border-foreground/40"
            disabled={busy}
            onChange={(ev) => setAddress(ev.target.value)}
            placeholder="https://myhome.duckdns.org"
            value={address}
          />
          <p aria-live="polite" className="min-h-4 text-[#ff4d4f] text-xs" role="alert">{error}</p>
          <div className="flex justify-end gap-2">
            <Button className="rounded-full" disabled={busy || !address.trim()} size="sm" type="submit">
              {status === 'redirecting' ? 'Opening sign-in…' : status === 'connecting' ? 'Connecting…' : 'Sign in'}
            </Button>
          </div>
        </form>
    </div>
  )
}

/**
 * Disconnect, after a check: a mis-click would mean signing in to Home Assistant again. The links
 * stay saved in this browser (`storage.ts`, per project and Home Assistant) and come back then.
 */
function DisconnectButton({ onDisconnect }: { onDisconnect: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button className="rounded-full" size="sm" variant="ghost">Disconnect</Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 rounded-2xl border-border/60 bg-background/95 p-4 text-sm shadow-lg backdrop-blur" side="top" sideOffset={10}>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <b className="font-medium">Disconnect Home Assistant?</b>
            <span className="text-muted-foreground text-xs leading-relaxed">
              Your devices stop updating here, and you'll have to sign in to Home Assistant again. Your links stay saved in this browser and come back when you do.
            </span>
          </div>
          <div className="flex justify-end gap-2">
            <Button className="rounded-full" onClick={() => setOpen(false)} size="sm" variant="ghost">Cancel</Button>
            <Button
              className="rounded-full"
              onClick={() => {
                setOpen(false)
                onDisconnect()
              }}
              size="sm"
              variant="destructive"
            >
              Disconnect
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** A card on the right, where a device's controls open. */
const CARD = 'pointer-events-auto absolute top-[var(--card-top,1rem)] right-[var(--card-right,1rem)] z-30 grid w-[min(20rem,calc(100vw-2rem))] gap-3 rounded-2xl border border-border/60 bg-background/95 p-4 text-sm shadow-lg backdrop-blur'
const ROW = 'flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left hover:bg-foreground/8'

/** Lights up a thing on the plan while a choice is pointed at, as Pascal's own hover does. */
function useHoverThing() {
  const hovered = useRef<string | null>(null)
  useEffect(() => () => void (hovered.current && useViewer.getState().setHoveredId(null)), [])
  return (id: string | null) => {
    hovered.current = id
    useViewer.getState().setHoveredId(id as never)
  }
}

/** The questions the linking left: which room an area is, then which thing a device drives. */
function QuestionCard({ home }: { home: HomeLayer }) {
  const call = useHass((s) => s.call)
  const byId = useMemo(() => new Map(home.things.map((t) => [t.id, t])), [home.things])
  const [index, setIndex] = useState(0)
  const hover = useHoverThing()
  const at = Math.min(index, home.questions.length - 1)
  const q = home.questions[at]
  if (!q) return null
  const counter = <span className="font-mono text-muted-foreground text-xs">{at + 1}/{home.questions.length}</span>
  const later = home.questions.length > 1 && (
    <Button className="rounded-full" onClick={() => setIndex((i) => (i + 1) % home.questions.length)} size="sm" variant="ghost">Later</Button>
  )

  if (q.kind === 'area') {
    return (
      <div className={CARD}>
        <div className="flex items-baseline justify-between gap-2">
          <b className="font-medium">Which room is "{q.area}"?</b>
          {counter}
        </div>
        <span className="text-muted-foreground text-xs">
          {q.devices} {q.devices === 1 ? 'device' : 'devices'} in this Home Assistant area. {q.choices.length < home.rooms.length ? 'It could be more than one room of your plan.' : 'No room of your plan has that name.'}
        </span>
        <ul className="ui-scroll grid grid-cols-[minmax(0,1fr)] max-h-64 gap-1 overflow-y-auto">
          {q.choices.map((room) => (
            <li key={room.id}>
              <button className={ROW} onClick={() => home.placeArea(q.area, room.id)} type="button">{room.name}</button>
            </li>
          ))}
        </ul>
        <div className="flex justify-between gap-2">
          <Button className="rounded-full" onClick={() => home.placeArea(q.area, null)} size="sm" variant="ghost">None of these</Button>
          {later}
        </div>
      </div>
    )
  }

  const { link } = q
  const name = home.entities[link.entityId]?.attributes.friendly_name ?? link.entityId
  const canBlink = ['light', 'switch', 'fan', 'media_player'].includes(domainOf(link.entityId))
  return (
    <div className={CARD}>
      <div className="flex items-baseline justify-between gap-2">
        <b className="font-medium">Which one is {name}?</b>
        {counter}
      </div>
      {canBlink && (
        <Button className="justify-self-start rounded-full" onClick={() => blink(call, link.entityId)} size="sm" variant="secondary">
          Blink it in your home
        </Button>
      )}
      <ul className="grid gap-1">
        {link.candidates.map((c) => {
          const t = byId.get(c.thingId)
          return (
            <li key={c.thingId}>
              <button className={ROW} onBlur={() => hover(null)} onClick={() => { hover(null); home.pick(link.entityId, c.thingId) }}
                onFocus={() => hover(c.thingId)} onMouseEnter={() => hover(c.thingId)} onMouseLeave={() => hover(null)} type="button">
                <span className="min-w-0 truncate">{t?.label ?? c.thingId}</span>
                <span className="shrink-0 text-muted-foreground text-xs">{t?.rooms.map((r) => r.name).join(', ')}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <div className="flex justify-between gap-2">
        <Button className="rounded-full" onClick={() => home.pick(link.entityId, null)} size="sm" variant="ghost">Not in the plan</Button>
        {later}
      </div>
    </div>
  )
}

/**
 * A room picked in the explore panel: what is linked in it, to its furniture or to the room itself
 * (a humidity sensor reads the room it is in), each to unlink, and every device of the visitor's
 * Home Assistant to add to the room itself, the room's own area first. Picks are kept in this browser.
 */
function RoomCard({ home, roomId, onSelect }: { home: HomeLayer; roomId: string; onSelect: (entityId: string | null) => void }) {
  const room = home.rooms.find((r) => r.id === roomId)
  const nodes = home.source.nodes as unknown as GraphNodes
  const things = useMemo(() => new Map(home.things.map((t) => [t.id, t])), [home.things])
  const nameOfEntity = useCallback((id: string) => home.entities[id]?.attributes.friendly_name ?? id, [home.entities])
  const linked = useMemo(
    () => home.links
      .filter((l) => (l.thingId ? things.get(l.thingId)?.rooms.some((r) => r.id === roomId) : l.status === 'room' && l.roomId === roomId))
      .map((l) => ({ link: l, name: nameOfEntity(l.entityId) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [home.links, things, roomId, nameOfEntity],
  )
  // what can be added to the room: devices (not people, scenes or the weather) not already in it,
  // those of the room's own Home Assistant area first
  const addable = useMemo(() => {
    const here = new Set(linked.map(({ link }) => link.entityId))
    const ownArea = new Set(home.entitiesInRoom(roomId))
    return home.links
      .filter((l) => l.status !== 'home' && !here.has(l.entityId) && home.isAvailable(l.entityId))
      .map((l) => ({ id: l.entityId, name: nameOfEntity(l.entityId), own: ownArea.has(l.entityId), area: home.infos.find((e) => e.entity_id === l.entityId)?.area }))
      .sort((a, b) => Number(b.own) - Number(a.own) || a.name.localeCompare(b.name))
  }, [home, linked, roomId, nameOfEntity])
  const name = room?.name ?? (nodes[roomId]?.name || 'This room')
  const labelOf = (id: string) => things.get(id)?.label ?? nodes[id]?.name ?? nodes[id]?.asset?.name ?? 'an item'

  return (
    <div className={CARD}>
      <div className="grid min-w-0">
        <b className="truncate font-medium">{name}</b>
        <span className="text-muted-foreground text-xs">
          {linked.length ? `${linked.length} linked ${linked.length === 1 ? 'device' : 'devices'}` : 'No linked devices'}
        </span>
      </div>
      {linked.length > 0 ? (
        <ul className="ui-scroll grid grid-cols-[minmax(0,1fr)] max-h-56 gap-1 overflow-y-auto">
          {linked.map(({ link, name: device }) => (
            <li className="flex items-center gap-1" key={link.entityId}>
              <button className={`${ROW} min-w-0 flex-1`} onClick={() => onSelect(link.entityId)} type="button">
                <span className="min-w-0 truncate">{device}</span>
                <span className="min-w-0 max-w-[45%] truncate text-muted-foreground text-xs">{link.thingId ? labelOf(link.thingId) : 'The room'}</span>
              </button>
              <Button className="rounded-full" onClick={() => home.pick(link.entityId, null)} size="sm" variant="ghost">Unlink</Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl bg-foreground/5 px-3 py-2 text-muted-foreground text-xs">
          Nothing in {name} is linked yet. Click a piece of furniture to link a device to it, or add one to the room below.
        </p>
      )}
      {addable.length > 0 && (
        <div className="grid gap-1">
          <span className="px-1 text-muted-foreground text-xs">Add to {name}</span>
          <ul className="ui-scroll grid grid-cols-[minmax(0,1fr)] max-h-56 gap-1 overflow-y-auto">
            {addable.map((d) => (
              <li key={d.id}>
                {/* a device Home Assistant puts in this very room but that isn't linked here yet: tinted, so it reads as left to do */}
                <button
                  className={`${ROW} min-w-0 ${d.own ? 'bg-amber-500/15 hover:bg-amber-500/25' : ''}`}
                  onClick={() => home.pick(d.id, `${ROOM_PICK}${roomId}`)}
                  title={d.own ? `In ${name} in Home Assistant, not linked yet` : undefined}
                  type="button"
                >
                  <span className="min-w-0 truncate">{d.name}</span>
                  <span className={`min-w-0 max-w-[45%] truncate text-xs ${d.own ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`}>
                    {d.own ? 'Not linked' : (d.area ?? 'No area')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * An item picked in a room: every device of that room to link to it (whatever it is: an air
 * conditioner's card lists the room's fan and lights too, as the visitor knows best), the devices it
 * drives, and then every other device of the visitor's Home Assistant: only devices that exist there
 * are offered, never a search. A pick is kept in this browser.
 */
function LinkCard({ home, itemId, onClose, roomId = null }: { home: HomeLayer; itemId: string; onClose: () => void; roomId?: string | null }) {
  const nodes = home.source.nodes as unknown as GraphNodes
  const node = nodes[itemId]
  const thing = home.things.find((t) => t.id === itemId)
  const label = thing?.label ?? node?.name ?? node?.asset?.name ?? 'This item'
  const rooms = useMemo(() => thing?.rooms ?? [], [thing])
  const room = (roomId ? home.rooms.find((r) => r.id === roomId) : undefined) ?? null
  const linked = home.links.filter((l) => l.thingId === itemId)
  const nameOfEntity = (id: string) => home.entities[id]?.attributes.friendly_name ?? id
  const labelOfThing = (id: string) => home.things.find((t) => t.id === id)?.label ?? nodes[id]?.name ?? 'another item'
  // how well a device fits this item: its kind first, then its room
  const score = useCallback((e: EntityInfo) => {
    const wants = wantsOf(e)
    const fits = thing && wants.place === 'thing' && (wants.kinds.includes(thing.kind) || wants.also?.includes(thing.kind))
    const here = home.links.find((l) => l.entityId === e.entity_id)?.roomId
    const sameRoom = rooms.some((r) => r.id === here) || (e.area !== undefined && rooms.some((r) => r.name === e.area))
    return (fits ? 2 : 0) + (sameRoom ? 1 : 0)
  }, [home.links, thing, rooms])
  // the room's devices: those its Home Assistant area pairs with, and those linked to its items
  const inRoom = useMemo(() => {
    if (!roomId) return []
    const ids = new Set(home.entitiesInRoom(roomId))
    return home.infos
      .filter((e) => ids.has(e.entity_id) && home.isAvailable(e.entity_id))
      .map((e) => ({ e, score: score(e) }))
      .sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name))
  }, [roomId, home, score])
  // the rest of the visitor's devices (not people, scenes or the weather), the likeliest first
  const choices = useMemo(() => {
    const shown = new Set(inRoom.map(({ e }) => e.entity_id))
    const placeable = new Set(home.links.filter((l) => l.status !== 'home' && l.thingId !== itemId).map((l) => l.entityId))
    return home.infos
      .filter((e) => placeable.has(e.entity_id) && !shown.has(e.entity_id) && home.isAvailable(e.entity_id))
      .map((e) => ({ e, score: score(e) }))
      .sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name))
  }, [home.infos, home.links, home.isAvailable, itemId, inRoom, score])
  const whereIs = (entityId: string) => {
    const link = home.links.find((l) => l.entityId === entityId)
    if (link?.thingId) return `Linked to ${labelOfThing(link.thingId)}`
    const inRoom = link?.status === 'room' ? home.rooms.find((r) => r.id === link.roomId) : undefined
    return inRoom ? `In ${inRoom.name}` : 'Not on the plan'
  }
  const unlinkedInRoom = inRoom.filter(({ e }) => !linked.some((l) => l.entityId === e.entity_id))

  return (
    <div className={CARD}>
      <div className="flex items-start justify-between gap-2">
        <div className="grid min-w-0">
          <b className="truncate font-medium">{label}</b>
          <span className="text-muted-foreground text-xs">{room?.name ?? (rooms.map((r) => r.name).join(', ') || 'Outside any room')}</span>
        </div>
        <Button className="rounded-full" onClick={onClose} size="sm" variant="ghost">Close</Button>
      </div>
      {linked.length > 0 && (
        <ul className="grid gap-1">
          {linked.map((l) => (
            <li className="flex items-center justify-between gap-2 rounded-xl bg-foreground/5 px-3 py-2" key={l.entityId}>
              <span className="min-w-0 truncate">{nameOfEntity(l.entityId)}</span>
              <Button className="rounded-full" onClick={() => home.pick(l.entityId, null)} size="sm" variant="ghost">Unlink</Button>
            </li>
          ))}
        </ul>
      )}
      {room && (
        <div className="grid gap-1">
          <span className="px-1 text-muted-foreground text-xs">In {room.name}</span>
          <ul className="ui-scroll grid grid-cols-[minmax(0,1fr)] max-h-64 gap-1 overflow-y-auto">
            {unlinkedInRoom.map(({ e }) => (
              <li key={e.entity_id}>
                <button className={ROW} onClick={() => home.pick(e.entity_id, itemId)} type="button">
                  <span className="min-w-0 truncate">{e.name}</span>
                  <span className="min-w-0 max-w-[45%] truncate text-muted-foreground text-xs">{whereIs(e.entity_id)}</span>
                </button>
              </li>
            ))}
            {!inRoom.length && <li className="px-3 py-2 text-muted-foreground text-xs">No Home Assistant devices in {room.name}. Your other devices are below.</li>}
            {inRoom.length > 0 && !unlinkedInRoom.length && <li className="px-3 py-2 text-muted-foreground text-xs">Every device in {room.name} is linked to this.</li>}
          </ul>
        </div>
      )}
      {choices.length > 0 && (
        <div className="grid gap-1">
          <span className="px-1 text-muted-foreground text-xs">{room ? 'Your other devices' : 'Your devices'}</span>
          <ul className="ui-scroll grid grid-cols-[minmax(0,1fr)] max-h-64 gap-1 overflow-y-auto">
            {choices.map(({ e }) => (
              <li key={e.entity_id}>
                <button className={ROW} onClick={() => home.pick(e.entity_id, itemId)} type="button">
                  <span className="min-w-0 truncate">{e.name}</span>
                  <span className="min-w-0 max-w-[45%] truncate text-muted-foreground text-xs">{e.area ?? 'No area'}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!choices.length && !inRoom.length && <p className="px-1 text-muted-foreground text-xs">Your Home Assistant has no devices to link.</p>}
    </div>
  )
}

/** Makes a device show itself for a moment: a light flashes, anything else toggles twice. */
function blink(call: (domain: string, service: string, data: Record<string, unknown>) => void, entityId: string) {
  const domain = domainOf(entityId)
  if (domain === 'light') return call('light', 'turn_on', { entity_id: entityId, flash: 'short' })
  call('homeassistant', 'toggle', { entity_id: entityId })
  window.setTimeout(() => call('homeassistant', 'toggle', { entity_id: entityId }), 1500)
}
