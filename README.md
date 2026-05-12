# DeepSeek V4 QA — VS Code Extension

DeepSeek V4 Pro & Flash models in GitHub Copilot Chat, tuned for long agentic sessions:

- **Four model variants** — Pro / Flash × thinking / non-thinking, with a per-variant `Thinking Effort` (high / max) control in the model picker
- **Vision proxy** — drop images into chat; a vision-capable model describes them so text-only DeepSeek can reason over the content. Descriptions are cached by image hash so the same screenshot doesn't re-cost on every turn
- **Context-window indicator** — live "% of window used · cache hit %" status bar item with KV-cache-aware compaction guidance. Replaces Copilot Chat's built-in widget, which is broken for all third-party providers ([microsoft/vscode#313458](https://github.com/microsoft/vscode/issues/313458))
- **Session cost & balance** — token counts, estimated spend in your account currency (USD/CNY auto-detect), and on-demand platform balance refresh. 75% Pro promo discount is opt-in and auto-expires
- **Persistent reasoning cache** — `reasoning_content` from thinking variants is fingerprinted, persisted across VS Code restarts, and replayed on multi-turn agent loops to preserve DeepSeek's KV cache
- **Robust request pipeline** — schema sanitization, tool-call/tool-result pairing validation, mid-stream truncation detection, retry on transient failures, and debug-only cache-trace snapshots for diagnosing 400s without leaking message content
- **Model discoverability** — variants stay visible in the picker before an API key is configured; setting the key surfaces them automatically
- **API key validation** — probes the configured endpoint before saving, with a fall-through path for proxy tokens that can't be validated upstream

## Install

```bash
git clone local
cd deepseek-v4-qa
npm install
npm run package
```

Then in VS Code: `Extensions` → `...` → `Install from VSIX...` → pick the newest `dist/deepseek-v4-qa-<version>.vsix`

Or link directly:

```bash
# Create a symlink from your VS Code extensions folder
mklink /D %USERPROFILE%\.vscode\extensions\konstantyn-ganenkov.deepseek-v4-qa-0.1.0 C:\path\to\deepseek-v4-qa
```

## Commands

| Command | Palette |
| ------- | ------- |
| Manage Provider | `DeepSeek QA: Manage Provider` |
| Set API Key | `DeepSeek QA: Set API Key` |
| Clear API Key | `DeepSeek QA: Clear API Key` |
| Set Vision Proxy Model | `DeepSeek QA: Set Vision Proxy Model` |
| Refresh Balance | `DeepSeek QA: Refresh Balance` |
| Clear Session Counter | `DeepSeek QA: Clear Session Counter` |
| Show Context Window Details | `DeepSeek QA: Show Context Window Details` |
| Show Cache Stats | `DeepSeek QA: Show Reasoning Cache Stats` |
| Show Logs | `DeepSeek QA: Show Logs` |

## Model Picker

All four variants remain visible in the Copilot Chat model picker.

- Thinking variants expose a per-model `Thinking Effort` control with `high` and `max`.
- If the provider is visible but not fully configured yet, use `Manage Provider` from the picker or command palette.

## Status Bar

One combined right-aligned item:

```
$(sparkle) DeepSeek QA · 16% ctx · $0.15  $17.07
```

- **Leading icon** signals context-window state: sparkle (healthy) → history (warn) → warning (critical), with the background colour shifting to yellow/red at the configured thresholds.
- **`16% ctx`** is the most recent turn's prompt size as a fraction of the model's input window — the actionable "should I compact?" signal.
- **`$0.15`** is the running session cost.
- **`$17.07`** is the platform balance after a refresh.
- **Click** opens the Manage Provider quick pick (set key, refresh balance, context details, cache stats, logs, settings).
- **Hover** shows the full breakdown: model, cache hit %, last turn details, situation-specific compaction advice, session totals, balance, reasoning effort, and the KV-cache primer.

## When to compact your chat (DeepSeek-specific)

GitHub Copilot Chat's built-in "Context Window" widget is hardcoded to show `0` for every third-party language-model provider ([microsoft/vscode#313458](https://github.com/microsoft/vscode/issues/313458)). That widget cannot be populated from extension code — so this extension ships its own.

The reason it matters: **DeepSeek caches by prefix**. Every request that shares its leading tokens with a recent request gets those tokens served from disk cache, billed at ~10% of the normal price and skipping the prefill step entirely. A long, stable chat accumulates a high cache-hit rate — the conversation gets *cheaper and faster* as it grows.

Compaction (summarising the chat into a shorter system message) **rewrites the prefix**, which invalidates the cache. The next 1–3 turns then have to rebuild it: every prompt token is a cache miss, first-token latency spikes by seconds, and the cost-per-turn jumps by an order of magnitude.

The rules of thumb the widget encodes:

| Window used | Cache hit | Recommendation |
| ----------- | --------- | -------------- |
| < 60% | high | **Keep going.** Compacting now would force the next several turns into full prefill — slower and more expensive than just letting the cache work. |
| 60–80% | any | Consider wrapping up the topic. Compact only if the conversation will continue for many more turns. |
| > 80% | any | **Compact or start a new chat now.** Truncation is imminent and the KV-cache penalty is worth it at this saturation. |
| any | < 30% & growing prompt | Something is invalidating the prefix — typically editing earlier messages, switching models mid-chat, or a randomised system context. Should self-recover within a few turns. |

Adjust thresholds via `deepseek-qa.contextWarnThreshold` and `deepseek-qa.contextCriticalThreshold`.

## Configuration

- `deepseek-qa.reasoningEffort`: default effort for `(thinking)` variants
- `deepseek-qa.modelIdOverrides`: remap API model IDs for DeepSeek-compatible proxy endpoints
- `deepseek-qa.baseUrl`: switch between DeepSeek and compatible gateways
- `deepseek-qa.contextWarnThreshold` / `deepseek-qa.contextCriticalThreshold`: percent thresholds for the context-window indicator
- `deepseek-qa.applyProDiscount`: apply the 75% Pro promo to cost estimates (off by default; auto-expires 2026-05-31)
- `deepseek-qa.debug`: emit verbose diagnostics to the **DeepSeek V4 QA** output channel

## Prior art

This extension started life by surveying two earlier MIT-licensed DeepSeek-in-Copilot projects — [Vizards/deepseek-v4-for-copilot](https://github.com/Vizards/deepseek-v4-for-copilot) (vision proxy concept) and [Laurent00TT/deepseek-v4-vscode-chat](https://github.com/Laurent00TT/deepseek-v4-vscode-chat) (balance + spend tracking idea). The current codebase has since been substantially rewritten end-to-end: a separate context-window tracker, persistent reasoning cache, hardened request/sanitisation pipeline, vision-description caching, currency-aware billing, KV-cache-aware compaction guidance, and the model variant set are all original to this project. Thanks to both upstreams for the starting direction.

## License

MIT — see the LICENSE file.
