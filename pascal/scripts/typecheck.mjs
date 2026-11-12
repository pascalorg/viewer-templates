import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const compiler = resolve(dirname(require.resolve('typescript/package.json')), 'bin/tsc')
const result = spawnSync(process.execPath, [compiler, '--noEmit', '--pretty', 'false'], {
  cwd: root, encoding: 'utf8',
})
if (result.error) throw result.error

// TypeScript has no per-directory noUnused setting. Imported raw plugin TS is
// checked even when node_modules is excluded. Keep every other dependency error,
// and every template diagnostic, while tolerating only unused dependency symbols.
const lines = result.stdout.split(/\r?\n/).filter(Boolean)
const dependencyUnused = (line) => /^(?:.*[/\\])?node_modules[/\\].*\(\d+,\d+\): error TS(?:6133|6138|6192|6196|6198|6199):/.test(line)
const errors = lines.filter((line) => !dependencyUnused(line))
if (errors.length) console.error(errors.join('\n'))
if (result.stderr) process.stderr.write(result.stderr)
const ignored = lines.length - errors.length
// Fail closed on compiler crashes or an unexpected non-diagnostic failure.
const passed = result.status === 0 || (result.status === 1 && ignored > 0 && !errors.length && !result.stderr)
if (passed) console.log(`Typecheck passed; ${ignored} unused dependency diagnostics ignored (template unused checks enabled).`)
process.exitCode = passed ? 0 : result.status || 1
