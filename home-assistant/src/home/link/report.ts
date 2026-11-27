import type { LinkReport } from './match'
import type { Thing } from './scene'

/** The linking as text, for a console or a test log: rooms, then every entity and what it drives. */
export function formatReport(report: LinkReport, things: Thing[]): string {
  const byId = new Map(things.map((t) => [t.id, t]))
  const name = (id?: string) => {
    const t = id ? byId.get(id) : undefined
    return t ? `${t.label} (${t.kind}${t.facing === null ? '' : `, faces ${Math.round((t.facing * 180) / Math.PI)}° by ${t.facingFrom}`})` : '-'
  }
  const lines = ['Areas → rooms']
  for (const a of report.areas) lines.push(`  ${a.area} → ${a.room ? `${a.room.name} (${a.likeness})` : 'no room'}`)
  const order = ['sure', 'likely', 'ask', 'unplaced', 'missing', 'room', 'home'] as const
  for (const status of order) {
    const links = report.links.filter((l) => l.status === status)
    if (!links.length) continue
    lines.push('', `${status} (${links.length})`)
    for (const l of links) {
      if (status === 'room' || status === 'home') {
        lines.push(`  ${l.entityId}`)
        continue
      }
      lines.push(`  ${l.entityId} → ${name(l.thingId)}  · ${l.why}`)
      if (status === 'ask') for (const c of l.candidates.slice(0, 4)) lines.push(`      ${c.score}  ${name(c.thingId)}  · ${c.why.join(', ')}`)
    }
  }
  if (report.unused.length) lines.push('', `things no entity drives (${report.unused.length})`, ...report.unused.map((id) => `  ${name(id)}`))
  return lines.join('\n')
}
