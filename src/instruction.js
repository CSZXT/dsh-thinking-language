/**
 * Language presets: the phrase used inside the reasoning-language instruction.
 *
 * `label` is what the instruction names as the target language, `written` is an
 * optional endonym added in parentheses so the model has an unambiguous anchor
 * even when the surrounding conversation is in another language.
 */
export const LANGUAGE_PRESETS = {
  chinese: { label: 'Chinese', written: '简体中文' },
  english: { label: 'English', written: null },
  japanese: { label: 'Japanese', written: '日本語' },
  korean: { label: 'Korean', written: '한국어' },
  russian: { label: 'Russian', written: 'русский' },
}

/** Every accepted `language` config value, in the order the settings form shows them. */
export const LANGUAGE_VALUES = Object.keys(LANGUAGE_PRESETS)

/** Section name this plugin owns; stable so a reload replaces rather than duplicates it. */
export const SECTION_NAME = 'plugin:thinking-language'

/** Runtime-context name this plugin owns (the user-role restatement of the same rule). */
export const CONTEXT_NAME = 'plugin:thinking-language'

/**
 * Placement of the runtime context within the ordered snapshot.
 *
 * The snapshot is emitted as one user-role message, so this order only decides
 * where inside it the restatement appears; a large value keeps the harness's own
 * runtime facts (sandbox and approval policy, subagent delegation) ahead of it.
 */
export const CONTEXT_ORDER = 500

/**
 * Placement of the instruction within the assembled system prompt.
 *
 * The band between the tool guides (1000–2900) and the harness-source section
 * (10000) holds reusable behavioral instructions; 1500 keeps this one next to
 * the tool descriptions it has to coexist with.
 */
export const SECTION_ORDER = 1500

/** Where the target language is named inside the instruction. */
function languageName(language) {
  const preset = LANGUAGE_PRESETS[language] ?? LANGUAGE_PRESETS.chinese
  return preset.written === null ? preset.label : `${preset.label} (${preset.written})`
}

/**
 * Build the instruction section text for one language.
 *
 * The text is deliberately written in the target language: a model that is
 * already reading the target language inside its own system prompt is far more
 * likely to continue in it. It asks for three things — the reasoning itself, a
 * default that outlives the language the user happens to type in, and an
 * explicit escape hatch so the rule never degrades factual accuracy.
 * @param language - a key of {@link LANGUAGE_PRESETS}.
 * @returns the section text (never empty).
 */
export function buildInstruction(language) {
  const name = languageName(language)
  return [
    `你的思考（reasoning / thinking）必须使用${name}。`,
    `用户用什么语言提问都不改变这一点：英文提问、英文日志、英文代码、英文专有名词都仍然用${name}思考。`,
    `只有当用户明确要求你换一种语言思考，或该任务的准确性明显依赖另一种语言时，才使用那种语言。`,
    `用户要求的回复语言不影响思考语言：思考语言由本条指令决定，与回复语言相互独立。`,
    `思考内容保持精确、完整，不要为了使用${name}而简化推理或省略关键技术细节。`,
  ].join('')
}

/**
 * Build the runtime-context restatement for one language.
 *
 * Deliberately shorter than {@link buildInstruction}: it belongs to a snapshot
 * the model reads on every step, and it exists to be the last thing said about
 * thinking before the next reasoning block.
 * @param language - a key of {@link LANGUAGE_PRESETS}.
 * @returns the context text (never empty).
 */
export function buildContext(language) {
  const name = languageName(language)
  return `思考语言：本条为固定策略，你的 reasoning / thinking 保持使用${name}，不因为用户提问、日志或代码使用其他语言而改变。`
}
