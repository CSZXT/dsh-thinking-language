// Verify a plugin entry specifier resolves and exports a valid plugin, using the
// same internal loader call the harness boot uses: internal.import(specifier, baseUrl, {}).
// Run it before restarting a harness that pins a new specifier, so a typo cannot
// break the boot.
// Usage: node verify-entry-specifier.mjs <specifier> <profileDir>
// Example: node verify-entry-specifier.mjs dsh-thinking-language/plugin C:/Users/T/.dsh/profiles/desktop
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const [specifier, profileDir] = process.argv.slice(2)
if (!specifier || !profileDir) {
  console.error('usage: node verify-entry-specifier.mjs <specifier> <profileDir>')
  process.exit(2)
}

const require = createRequire(import.meta.url)
const ADDON = process.env.DSH_REQUIRE_BUILTIN_ADDON
  ?? 'G:/软件/DeepSeek/resources/app.asar.unpacked/dsh/node_modules/node-addon-require-builtin-win32-x64-msvc/prebuilt/win32-x64-msvc-napi-v9.node'

async function loadExports() {
  try {
    const addon = require(ADDON)
    const requireBuiltin = addon.requireBuiltin ?? addon.default?.requireBuiltin
    const raw = requireBuiltin?.('internal/modules/esm/loader')?.getOrInitializeCascadedLoader()
    if (raw !== undefined) return { exports: await raw.import(specifier, pathToFileURL(join(profileDir, 'cordis.yml')).href, {}), via: 'internal loader' }
  } catch (error) {
    console.log('internal loader unavailable:', error.message.split('\n')[0])
  }
  const resolution = createRequire(join(profileDir, 'probe.mjs')).resolve(specifier)
  return { exports: await import(pathToFileURL(resolution).href), via: 'public dynamic import' }
}

const { exports, via } = await loadExports()
const plugin = exports.default ?? exports
const shape = {
  'apply function': typeof plugin.apply === 'function',
  'inject': Array.isArray(exports.inject) ? exports.inject : (Array.isArray(plugin.inject) ? plugin.inject : null),
  'Config schema': typeof exports.Config?.['~standard']?.validate === 'function' || typeof exports.Config === 'function',
}

console.log(`specifier: ${specifier}`)
console.log(`loaded via: ${via}`)
for (const [key, value] of Object.entries(shape)) console.log(`  ${key}: ${JSON.stringify(value)}`)
const ok = shape['apply function']
console.log(ok ? '\nOK: entry specifier resolves to a mountable plugin' : '\nFAIL: exports do not look like a plugin')
process.exit(ok ? 0 : 1)
