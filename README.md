# dsh-thinking-language

让 DeepSeek Harness 的**思考（reasoning / thinking）固定使用指定语言**（默认简体中文）的 Host 插件。

它注册一个 system prompt 段落，明确要求模型用目标语言进行内部思考；**回复语言不受影响**，仍然跟随用户。

## 为什么需要它

DSH 的协议层没有“思考语言”这个开关：`dsh-llm` / `dsh-llm-deepseek` 只暴露 `thinking: enabled|disabled` 与 `reasoningEffort`，没有任何语言字段（[system-prompt 包](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/system-prompt.md) 也只提供 sections / contexts / variables / tools 四类贡献点）。因此唯一可控的位置就是系统提示：本插件把“思考语言”作为一条**每轮都在场**的段落写进系统提示。

实测基线（本机 desktop profile，`deepseek-flash`，`reasoningEffort: max`）：

| 场景 | 思考中的汉字占比 |
| --- | --- |
| 英文提问的子代理会话 | 0.0%（11910 个拉丁字母 / 0 个汉字） |
| 中文提问的本机会话 | 0.3%（144 个汉字 / 53392 个拉丁字母） |

也就是说，即使你用中文提问，模型**默认仍然用英文思考**。本插件就是把这个默认改掉。

## 它做什么

- 通过 `ctx.systemPrompt.section()` 注册一个全局段落 `plugin:thinking-language`（order `1500`，位于工具说明之后、harness 环境说明之前）。
- 同时通过 `ctx.systemPrompt.context()` 注册一条同名 runtime context（order `500`）。它渲染成一条**用户角色**的运行时快照，位置在历史之后、下一次思考之前——这是把“用中文思考”放在离推理最近的地方。
- 两处都是静态文本：系统提示前缀与快照内容都保持稳定，模型侧 KV cache 不会被反复改写（agent-loop 只在与已提交快照不同时才写入）。
- 覆盖所有 agent：主会话、子代理、workflow 里的 agent、任务看板的执行会话。
- 指令写明：思考语言**独立于回复语言**；用户提问用什么语言都不改变它；只有用户明确要求换语言、或任务准确性明显依赖另一种语言时才例外。

## 配置

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 是否注册这两处；关闭后系统提示与运行时快照完全回到原样 |
| `language` | `'chinese'` | `chinese` / `english` / `japanese` / `korean` / `russian` |

两个字段都是 schema-volatile：在插件设置面板里改动会**立即生效**，不需要重启，也不会重挂插件。

在 `cordis.patch.yml` 里的写法：

```yaml
- insert:
    - id: thinking-language
      name: 'dsh-thinking-language/plugin'
      config:
        enabled: true
        language: chinese
```

### 为什么 specifier 写成 `dsh-thinking-language/plugin`

harness 的 Loader 用 `internal.import(specifier, baseUrl)` 加载插件，而 **Node 的 ESM 模块注册表按 specifier 缓存到进程结束**：同一个 specifier 永远返回第一次加载的模块对象。实测（`node` v24.21，同一 internal loader）：

```text
1st internal import        -> version-1
2nd internal import        -> version-1   (旧模块：改盘不生效)
3rd with ?v= cache-bust    -> version-2   (换 URL 才加载新代码)
```

所以代码更新要生效，必须换一个 specifier；本包导出 `.` 与 `./plugin` 指向同一实现（`src/index.js`），后者就是给“替换已装包”用的新 URL。开发时改一次代码就把这个路径换一次（`./plugin` → `./plugin2`，同时 `exports` 增加同名字段），即免重启生效。

## 安装

作为本地 bundle 安装（`install_bundle` 接受路径说明符）：

```text
plugin_manager install_bundle <本包目录的绝对路径>
```

它会把本包加进 profile 的 `dependencies` 与 `dsh.profile.bundles`，随后由 bundle 的 `cordis.patch.yml` 插入插件行。

- 首次安装此前不存在的 bundle 可以走 HMR 直接生效。
- 替换已安装包的代码：**要么重启一次（最省事），要么按上一节换 specifier**。仅靠“关闭再打开插件”不会重新加载模块（如上实测）。

## 验收

1. 离线：`node test/plugin.test.mjs`（本目录 `test/`）验证 schema、段落与 runtime context 的注册/回收、volatile 字段改动。
2. 在线的实测数据（同一 profile、`deepseek-flash`、`reasoningEffort: max`；方法：给子代理派一个纯英文/纯中文的小任务，然后逐帧解压它的会话日志统计 `reasoning` 块的字符占比）：

| 场景 | 指令 | 思考中汉字占 han+latin |
| --- | --- | --- |
| 基线（无插件）英文提问 | — | 0.0% |
| 基线（无插件）中文提问（主会话 94 段思考） | — | 0.3% |
| 插件启用，中文提问 | 第一版 | **73.4%** |
| 插件启用，英文提问且要求英文作答 | 第一版 | 0.0%（被“除非用户要求”豁免） |

第三行说明链路生效；第四行是第一版措辞的已知漏洞，因此当前版本改用更强措辞（“用户用什么语言提问都不改变”），并加了 runtime context 复述。第四行之后的两版措辞未能在本进程内热加载（原因见上一节），需重启后复测。

3. 手工复核：会话日志是**多帧拼接**的 zstd，`zstdDecompressSync` 只解第一帧，必须逐帧解压后再统计。

## 已知限制

- 这是**提示层约束，不是协议层强制**：模型仍可能在个别回合偏离，尤其是把“用中文思考”的准确性说得比任务更次要时。任何声称能 100% 锁定的做法都需要改模型服务端，而不是插件。
- 用户明确要求“用英文思考”时，指令会让位（这是刻意保留的准确性出口）。
- 消耗的额外 token 是一个固定段落（约 130 字，按请求重复）加一条稳定快照。
- 不改变回复语言、不改变工具说明、不改变思考长度（`reasoningEffort` 仍由模型配置决定）。

## License

MIT
