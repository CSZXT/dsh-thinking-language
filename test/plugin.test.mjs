/**
 * Offline checks for dsh-thinking-language: schema contract, section lifecycle,
 * volatile-field edits, and instruction text. No DSH host required.
 *
 * Usage: node test/plugin.test.mjs
 */
import assert from 'node:assert/strict'
import { Config, apply, inject, readField } from '../src/index.js'
import {
  CONTEXT_NAME,
  CONTEXT_ORDER,
  LANGUAGE_VALUES,
  SECTION_NAME,
  SECTION_ORDER,
  buildContext,
  buildInstruction,
} from '../src/instruction.js'

const results = []
function test(name, fn) {
  try {
    fn()
    results.push(`ok   ${name}`)
  } catch (error) {
    results.push(`FAIL ${name}\n     ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

/** A Context stub recording section and runtime-context registrations with disposals. */
function fakeCtx() {
  const registered = []
  const contexts = []
  const listeners = new Map()
  const record = (list) => (entry) => {
    assert.equal(typeof entry.name, 'string')
    assert.equal(typeof entry.order, 'number')
    assert.equal(typeof entry.text, 'string')
    const stored = { ...entry, disposed: false }
    list.push(stored)
    return () => {
      stored.disposed = true
    }
  }
  const ctx = {
    systemPrompt: {
      section: record(registered),
      context: record(contexts),
    },
    on(name, listener) {
      listeners.set(name, listener)
      return () => listeners.delete(name)
    },
  }
  const alive = (list) => list.filter((entry) => !entry.disposed)
  return {
    ctx,
    registered,
    contexts,
    live: () => alive(registered),
    liveContexts: () => alive(contexts),
    fire: (name, ...args) => listeners.get(name)?.(...args),
  }
}

/** A Loader-style volatile reference. */
function volatileRef(initial) {
  let value = initial
  return { get: () => value, set: (next) => { value = next } }
}

test('schema validates language presets and applies defaults', () => {
  // Volatile fields parse into a live reference the plugin unwraps with readField.
  assert.equal(readField(Config({}).enabled, undefined), true)
  assert.equal(readField(Config({}).language, undefined), 'chinese')
  assert.equal(readField(Config({ language: 'english' }).language, undefined), 'english')
  assert.equal(readField(Config({ enabled: false }).enabled, undefined), false)
  assert.throws(() => Config({ language: 'klingon' }))
  assert.throws(() => Config({ enabled: 'yes' }))
})

test('inject declares the system prompt service', () => {
  assert.deepEqual(inject, ['systemPrompt'])
})

test('readField unwraps volatile references and passes plain values through', () => {
  assert.equal(readField(volatileRef(false), true), false)
  assert.equal(readField('english', 'chinese'), 'english')
  assert.equal(readField(undefined, 'chinese'), 'chinese')
  assert.equal(readField(null, true), null)
})

test('apply registers exactly one global section and one runtime context on activation', () => {
  const { ctx, registered, contexts, live, liveContexts } = fakeCtx()
  apply(ctx, Config({}))
  assert.equal(registered.length, 1)
  assert.equal(live().length, 1)
  assert.equal(registered[0].name, SECTION_NAME)
  assert.equal(registered[0].order, SECTION_ORDER)
  assert.match(registered[0].text, /^你的思考（reasoning \/ thinking）必须使用Chinese \(简体中文\)。/)
  assert.match(registered[0].text, /用户用什么语言提问都不改变这一点/)
  assert.match(registered[0].text, /思考语言由本条指令决定，与回复语言相互独立。/)

  assert.equal(contexts.length, 1)
  assert.equal(liveContexts().length, 1)
  assert.equal(contexts[0].name, CONTEXT_NAME)
  assert.equal(contexts[0].order, CONTEXT_ORDER)
  assert.match(contexts[0].text, /固定策略/)
  assert.notEqual(contexts[0].text, registered[0].text)
})

test('repeated syncs with unchanged settings do not re-register', () => {
  const { ctx, registered, contexts, fire } = fakeCtx()
  apply(ctx, Config({}))
  fire('loader/volatile-update')
  fire('loader/volatile-update')
  assert.equal(registered.length, 1)
  assert.equal(contexts.length, 1)
})

test('a volatile language edit swaps both registrations', () => {
  const { ctx, registered, contexts, live, liveContexts, fire } = fakeCtx()
  const language = volatileRef('chinese')
  apply(ctx, { enabled: true, language })
  assert.match(live()[0].text, /简体中文/)
  assert.match(liveContexts()[0].text, /简体中文/)

  language.set('english')
  fire('loader/volatile-update')
  assert.equal(registered.length, 2)
  assert.equal(contexts.length, 2)
  assert.equal(live().length, 1)
  assert.equal(liveContexts().length, 1)
  assert.match(live()[0].text, /English/)
  assert.match(liveContexts()[0].text, /English/)
})

test('a volatile disable disposes both registrations, and re-enabling restores them', () => {
  const { ctx, live, liveContexts, fire } = fakeCtx()
  const enabled = volatileRef(true)
  apply(ctx, { enabled, language: 'chinese' })
  assert.equal(live().length, 1)
  assert.equal(liveContexts().length, 1)

  enabled.set(false)
  fire('loader/volatile-update')
  assert.equal(live().length, 0)
  assert.equal(liveContexts().length, 0)

  enabled.set(true)
  fire('loader/volatile-update')
  assert.equal(live().length, 1)
  assert.equal(liveContexts().length, 1)
})

test('enabled: false registers nothing at activation', () => {
  const { ctx, registered, contexts } = fakeCtx()
  apply(ctx, Config({ enabled: false }))
  assert.equal(registered.length, 0)
  assert.equal(contexts.length, 0)
})

test('every preset renders a non-empty, language-named instruction and context', () => {
  for (const language of LANGUAGE_VALUES) {
    for (const text of [buildInstruction(language), buildContext(language)]) {
      assert.ok(text.length > 30, `${language} text too short`)
      assert.ok(!text.includes('{{'), `${language} text must not contain a prompt variable group`)
      assert.ok(!text.includes('undefined'), `${language} text leaked undefined`)
    }
  }
  assert.match(buildInstruction('japanese'), /日本語/)
  assert.match(buildInstruction('english'), /English/)
  assert.match(buildContext('korean'), /한국어/)
})

test('an unknown language key falls back to Chinese rather than throwing', () => {
  assert.match(buildInstruction('nope'), /简体中文/)
  assert.match(buildContext('nope'), /简体中文/)
})

console.log(results.join('\n'))
console.log(process.exitCode === 1 ? '\nsome checks failed' : '\nall checks passed')
