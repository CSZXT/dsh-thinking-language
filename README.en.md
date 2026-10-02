# dsh-thinking-language

A DeepSeek Harness Host plugin that pins the model's **reasoning (thinking) language** to a configured language (Simplified Chinese by default).

It registers one system-prompt section instructing the model to reason in the target language. The visible reply language is untouched and still follows the user.

## Why

The harness has no wire-level switch for reasoning language: `dsh-llm` / `dsh-llm-deepseek` expose only `thinking: enabled|disabled` and `reasoningEffort`, and the system-prompt registry offers sections / contexts / variables / tools. The prompt is therefore the only honest control point, and this plugin keeps an instruction there on **every** request.

Measured baseline on the local desktop profile (`deepseek-flash`, `reasoningEffort: max`):

| Scenario | Han share of reasoning |
| --- | --- |
| Subagent asked in English | 0.0% (11910 Latin letters, 0 Han) |
| Local session asked in Chinese | 0.3% (144 Han, 53392 Latin letters) |

Even a Chinese prompt mostly reasons in English by default; this plugin changes that default.

## What it does

- Registers the global section `plugin:thinking-language` at order `1500` (after tool guidance, before the harness environment sections) through `ctx.systemPrompt.section()`.
- Registers a same-named runtime context at order `500` through `ctx.systemPrompt.context()`. It becomes a user-role snapshot placed after retained history and right before the next reasoning block.
- Both texts are static, so the prompt prefix and the snapshot stay cache-stable (agent-loop only commits a snapshot that differs from the retained one).
- Applies to every agent: root sessions, subagents, workflow agents, task-board runs.
- States that the thinking language is independent of the reply language, that the language a user types in does not change it, and that only an explicit request or a genuine accuracy need may override it.

## Configuration

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Register both contributions at all |
| `language` | `'chinese'` | `chinese` / `english` / `japanese` / `korean` / `russian` |

Both fields are schema-volatile: editing them in the plugin settings form takes effect immediately, without a remount.

### Why the entry specifier is `dsh-thinking-language/plugin`

The harness Loader imports a plugin with `internal.import(specifier, baseUrl)`, and Node's ESM module registry caches a module job by specifier for the process lifetime: the same specifier always returns the first module object. Measured against the same internal loader on node v24.21:

```text
1st internal import        -> version-1
2nd internal import        -> version-1   (stale: changing the file changes nothing)
3rd with ?v= cache-bust    -> version-2   (a new URL loads the new code)
```

A code change therefore only reaches a live harness through a new specifier. This package exports both `.` and `./plugin` for the same implementation (`src/index.js`); the latter is the fresh URL used when replacing an installed package. During development, bump the path (`./plugin` → `./plugin2` plus the matching `exports` entry) to reload without restarting.

## Install

Install as a local bundle (`install_bundle` accepts a path spec):

```text
plugin_manager install_bundle <absolute path to this package>
```

- A bundle that was not installed before can activate through HMR.
- Replacing an installed package needs either one restart (simplest) or a new specifier as described above. Toggling the row off and on does **not** reload the module.

## Verification

1. Offline: `node test/plugin.test.mjs` — schema, section and runtime-context lifecycle, volatile edits.
2. Live measurements on the same profile (`deepseek-flash`, `reasoningEffort: max`), by decompressing a subagent's session log frame by frame and counting characters inside `reasoning` blocks:

| Scenario | Instruction | Han share of han+latin |
| --- | --- | --- |
| Baseline, English prompt | — | 0.0% |
| Baseline, Chinese prompt (94 reasoning blocks) | — | 0.3% |
| Plugin on, Chinese prompt | first wording | **73.4%** |
| Plugin on, English prompt asking for an English reply | first wording | 0.0% (excused by the "unless the user asks" clause) |

The fourth row is the known gap of the first wording, which is why the current version states that the language a user types in does not change the rule and restates it as runtime context. Those two changes could not be hot-loaded in the running process (see above), so re-measure after a restart.

3. Note for manual checks: the session log is **multi-frame** zstd; `zstdDecompressSync` decodes only the first frame.

## Known limitations

- This is a prompt-level constraint, not a protocol-level guarantee: the model can still drift, especially when explicitly told to think in another language.
- Costs one fixed section per request (~120 characters).
- Does not change reply language, tool guidance, or reasoning length.

## License

MIT
