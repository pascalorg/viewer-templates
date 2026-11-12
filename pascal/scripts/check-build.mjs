import { spawnSync } from 'node:child_process'
import { readFile, readdir, lstat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const MiB = 1024 * 1024
// Match @pascal-app/cli 1.1.2; keep stricter budgets to leave hosting headroom.
const extensions = new Set('html js mjs css json wasm map svg png jpg jpeg webp avif gif ico txt woff woff2 ttf glb gltf bin ktx2 hdr mp3 ogg wav mp4 webm'.split(' '))
const files = []
const failures = []
const forbidden = (name) => name === '@pascal-app/editor' || name === 'next'

async function walk(relative = '') {
  for (const entry of await readdir(resolve(dist, relative), { withFileTypes: true })) {
    const path = relative ? `${relative}/${entry.name}` : entry.name
    const stat = await lstat(resolve(dist, path))
    if (stat.isSymbolicLink()) { failures.push(`Symlink refused: ${path}`); continue }
    const parts = path.split('/')
    if (path.length > 512 || /[^\x21-\x7e]|[\\%?#:]/.test(path) || parts.some((part, i) =>
      part.startsWith('.') && !(i === 0 && part === '.well-known'),
    )) { failures.push(`Invalid build path: ${path}`); continue }
    if (stat.isDirectory()) { await walk(path); continue }
    if (!stat.isFile() || !extensions.has(path.split('.').at(-1))) {
      failures.push(`Unsupported build file: ${path}`)
      continue
    }
    files.push({ path, bytes: stat.size })
    if (stat.size > 20 * MiB) failures.push(`${path} exceeds 20 MiB`)
  }
}

await walk()
const total = files.reduce((sum, file) => sum + file.bytes, 0)
if (!files.some((file) => file.path === 'index.html')) failures.push('Missing dist/index.html')
if (files.some((file) => file.path.startsWith('tests/') || file.path === 'runtime-manifest.json')) {
  failures.push('Test harness output in dist; rebuild with npm run build before deployment')
}
if (files.length > 1500) failures.push('Build exceeds 1,500 files')
if (total > 90 * MiB) failures.push('Build exceeds 90 MiB total')

const report = JSON.parse(await readFile(resolve(dist, 'build-boundary.json'), 'utf8'))
if (!(report.moduleCount > 0) || !Array.isArray(report.packages) || !Array.isArray(report.entryPluginModules) || !Array.isArray(report.testModules)) {
  failures.push('Missing or invalid build boundary report; rebuild dist')
} else {
  for (const name of report.packages.filter(forbidden)) failures.push(`Forbidden bundled package: ${name}`)
  if (report.entryPluginModules.length) failures.push(`Plugin code in entry chunk: ${report.entryPluginModules.join(', ')}`)
  if (report.testModules.length) failures.push(`Test modules in production build: ${report.testModules.join(', ')}`)
}

// Check the installed tree and lockfile too, even for packages that were tree-shaken away.
const installed = spawnSync('npm', ['ls', '@pascal-app/editor', 'next', '--all', '--json'], {
  cwd: root, encoding: 'utf8',
})
if (installed.error) throw installed.error
const tree = JSON.parse(installed.stdout)
function inspectTree(node) {
  for (const [name, dependency] of Object.entries(node.dependencies || {})) {
    if (forbidden(name)) failures.push(`Forbidden installed package: ${name}`)
    inspectTree(dependency)
  }
}
inspectTree(tree)
// npm ls exits 1 for a successful empty filtered list, without an errors field.
if (tree.error || tree.errors || (installed.status !== 0 && installed.status !== 1)) {
  failures.push(`npm ls failed: ${installed.stdout || installed.stderr}`)
}
const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'))
for (const path of Object.keys(lock.packages || {})) {
  if (/(?:^|\/)node_modules\/(?:@pascal-app\/editor|next)$/.test(path)) failures.push(`Forbidden locked package: ${path}`)
}

console.log(`Build: ${files.length} files, ${total.toLocaleString('en-US')} bytes (${(total / MiB).toFixed(2)} MiB)`)
console.log('Largest files:')
for (const file of files.sort((a, b) => b.bytes - a.bytes).slice(0, 10)) console.log(`  ${file.bytes.toLocaleString('en-US')}  ${file.path}`)
console.log(`Boundary: ${report.moduleCount} modules checked; @pascal-app/editor and next absent from bundle, install and lockfile`)
if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log('Passed: 20 MiB/file, 90 MiB total, 1,500 files, hosting extensions, package boundary and no test harnesses')
}
