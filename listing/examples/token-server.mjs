// A minimal token endpoint for private projects. It runs on YOUR server, holds your
// Pascal API key, and mints a short-lived viewer token for one project.
//
//   PASCAL_API_KEY=sk_live_... VIEWER_ORIGIN=http://localhost:5173 node examples/token-server.mjs
//
// The API key's owner must be able to manage the project (workspace owner or admin).
// Put your own login check where marked: only people you allow should get a token.
import { createServer } from 'node:http'

const PASCAL_BASE_URL = process.env.PASCAL_BASE_URL ?? 'https://editor.pascal.app'
const API_KEY = process.env.PASCAL_API_KEY
const VIEWER_ORIGIN = process.env.VIEWER_ORIGIN ?? 'http://localhost:5173'
const PORT = Number(process.env.PORT ?? 8787)
if (!API_KEY) throw new Error('Set PASCAL_API_KEY (server side only, never in the browser)')

createServer(async (request, response) => {
  const cors = {
    'Access-Control-Allow-Origin': VIEWER_ORIGIN,
    'Access-Control-Allow-Credentials': 'true',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  }
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
  const project = url.searchParams.get('project')
  if (request.method !== 'GET' || url.pathname !== '/token' || !project) {
    response.writeHead(404, cors).end(JSON.stringify({ error: 'not_found' }))
    return
  }

  // Your login check goes here, e.g. read your session cookie and refuse with 401.

  const minted = await fetch(
    `${PASCAL_BASE_URL}/api/projects/${encodeURIComponent(project)}/viewer-grants`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      // externalSubject is an optional audit label for who this token was for.
      body: JSON.stringify({ origins: [VIEWER_ORIGIN], ttlSeconds: 3600 }),
    },
  )
  const body = await minted.json().catch(() => ({}))
  if (!minted.ok) {
    response.writeHead(minted.status, cors).end(JSON.stringify({ error: body.error ?? 'mint_failed' }))
    return
  }
  response.writeHead(200, cors).end(JSON.stringify({ token: body.token, expiresAt: body.expiresAt }))
}).listen(PORT, () => console.log(`Token endpoint on http://localhost:${PORT}/token`))
