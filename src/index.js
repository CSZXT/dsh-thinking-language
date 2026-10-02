/**
 * Reasoning-language pin for DeepSeek Harness.
 *
 * The harness owns no wire-level switch for the language a model reasons in, so
 * the only honest control point is the prompt: this plugin registers one
 * system-prompt section that tells the model which language its thinking must
 * use. It is a strong, always-present instruction rather than a hard guarantee —
 * a model can still deviate — but it is stable across turns and agents, and it
 * never touches the visible reply language.
 *
 * @module dsh-thinking-language
 */
import Schema from '@deepseek-ai/schemastery'
import {
  CONTEXT_NAME,
  CONTEXT_ORDER,
  LANGUAGE_VALUES,
  SECTION_NAME,
  SECTION_ORDER,
  buildContext,
  buildInstruction,
} from './instruction.js'

/** Services this plugin needs; the row stays inactive until `systemPrompt` exists. */
export const inject = ['systemPrompt']

/**
 * Configuration schema. Every field is `volatile()` so the plugin settings form
 * can commit a change into this running instance instead of remounting it; the
 * values are therefore read at use time via {@link readField}.
 */
export const Config = Schema.object({
  enabled: Schema.boolean().default(true).volatile(),
  language: Schema.union(LANGUAGE_VALUES).default('chinese').volatile(),
})

/**
 * Read one configuration field as it stands right now.
 *
 * The Loader hands schema-volatile fields as stable references it commits in
 * place, so the value must be read at use time rather than captured when the
 * plugin activates; a plain value (a programmatic mount, or a non-volatile
 * field) is returned unchanged.
 * @param field - the config field as the Loader handed it.
 * @param fallback - value to use when the field is absent.
 * @returns the effective field value.
 */
export function readField(field, fallback) {
  if (field === undefined) return fallback
  if (typeof field === 'object' && field !== null && typeof field.get === 'function') return field.get()
  return field
}

/**
 * Register the reasoning-language instruction, following live setting edits.
 *
 * Two registrations carry the same rule, because they pull their weight in
 * different places: the section is part of the system prompt every step starts
 * from, while the runtime context is a sourced user-role snapshot that sits
 * *after* retained history — the position closest to the next reasoning block,
 * which is where a model that has been reading English for many turns is most
 * likely to keep reasoning in English. Both texts are static, so an unchanged
 * setting stays cache-stable and agent-loop does not rewrite a snapshot it
 * would render identically.
 * @param ctx - plugin context with `systemPrompt` injected.
 * @param config - resolved plugin config (schema defaults applied by the Loader).
 */
export function apply(ctx, config) {
  const enabled = () => readField(config?.enabled, true) !== false
  const language = () => readField(config?.language, 'chinese')

  let applied
  let disposeSection
  let disposeContext

  const sync = () => {
    const next = { enabled: enabled(), language: language() }
    if (applied !== undefined && applied.enabled === next.enabled && applied.language === next.language) return
    applied = next

    disposeSection?.()
    disposeSection = undefined
    disposeContext?.()
    disposeContext = undefined
    if (!next.enabled) return

    disposeSection = ctx.systemPrompt.section({
      name: SECTION_NAME,
      order: SECTION_ORDER,
      text: buildInstruction(next.language),
    })
    disposeContext = ctx.systemPrompt.context({
      name: CONTEXT_NAME,
      order: CONTEXT_ORDER,
      text: buildContext(next.language),
    })
  }

  ctx.on('loader/volatile-update', () => {
    sync()
  })
  sync()
}
