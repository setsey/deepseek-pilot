# DeepSeek Pilot — VS Code Extension

Run **DeepSeek V4 Pro & Flash** inside GitHub Copilot Chat — with the small comforts that make long agentic sessions actually pleasant.

DeepSeek's V4 models are dramatically cheaper than the flagships from OpenAI and Anthropic while staying competitive on coding work, and their prefix-cache pricing means a long, stable chat gets *cheaper and faster* as it grows. Copilot Chat ships generic BYOK support — DeepSeek Pilot adds the DeepSeek-specific pieces on top: KV-cache-aware compaction guidance, real session cost and platform balance in the status bar, vision attachments routed through a describer model, and one-click wiring as Copilot's hidden utility model for titles and commit messages.

Requires **VS Code 1.120+** and the GitHub Copilot Chat extension.

## What you get

- **Four model variants in the picker** — Pro and Flash, each with thinking / non-thinking modes, grouped under one **DeepSeek V4** row. Thinking variants expose a per-model **Thinking Effort** (high / max) control.
- **Drop images into chat with a text-only model** — a vision-capable describer model summarises each attachment so DeepSeek can reason over the content. Descriptions are cached by image hash, so the same screenshot never re-bills.
- **Live context-window indicator, DeepSeek-aware** — status-bar item showing `% of window used · cache-hit %` with KV-cache-aware guidance ("keep going, your cache is healthy" vs. "compact now"). Configurable thresholds.
- **Real session cost & platform balance** — token counts, running spend in your account currency (USD / CNY auto-detected from the DeepSeek API), and a one-click balance refresh. The 75% Pro promo discount is opt-in and auto-expires.
- **Persistent reasoning cache** — reasoning traces from thinking variants are fingerprinted, persisted across VS Code restarts, and replayed during multi-turn agent loops so DeepSeek's KV cache stays warm.
- **Wire as Copilot's utility model** — one-click commands route Copilot's background flows (chat titles, summaries, commit messages, intent detection) through DeepSeek Flash, where the dollar cost is negligible.
- **Production-grade request pipeline** — schema sanitisation, tool-call / tool-result pairing, mid-stream truncation detection, retry on transient failures, and debug-only cache-trace snapshots for diagnosing odd 400s without leaking message content.
- **Friendly setup** — variants stay visible in the picker before an API key is configured (with a warning icon), and key validation probes the configured endpoint before saving, with a fall-through path for proxy tokens that can't be validated upstream.

## Install

**From the Marketplace** (recommended once published):

```text
ext install konstantyn-ganenkov.deepseek-pilot
```

Or open the Extensions view (`Ctrl+Shift+X`) and search for **DeepSeek Pilot**.

**From a local build:**

```bash
npm install
npm run package
```

Then in VS Code: `Extensions` → `...` → `Install from VSIX...` → pick the newest `dist/deepseek-pilot-<version>.vsix`.

Or link directly so a `npm run watch` keeps the installed copy in sync:

```bash
# Symlink from your VS Code extensions folder (Windows; mklink requires an admin shell or developer mode)
mklink /D %USERPROFILE%\.vscode\extensions\konstantyn-ganenkov.deepseek-pilot-<version> C:\path\to\deepseek-pilot
```

## Commands

| Command | Palette |
| ------- | ------- |
| Manage Provider | `DeepSeek Pilot: Manage Provider` |
| Set API Key | `DeepSeek Pilot: Set API Key` |
| Clear API Key | `DeepSeek Pilot: Clear API Key` |
| Set Vision Proxy Model | `DeepSeek Pilot: Set Vision Proxy Model` |
| Refresh Balance | `DeepSeek Pilot: Refresh Balance` |
| Clear Session Counter | `DeepSeek Pilot: Clear Session Counter` |
| Show Context Window Details | `DeepSeek Pilot: Show Context Window Details` |
| Show Cache Stats | `DeepSeek Pilot: Show Reasoning Cache Stats` |
| Clear Reasoning Cache | `DeepSeek Pilot: Clear Reasoning Cache` |
| Use as Copilot Utility Model | `DeepSeek Pilot: Use as Copilot Utility Model` |
| Use as Copilot Utility Small Model | `DeepSeek Pilot: Use as Copilot Utility Small Model` |
| Show Logs | `DeepSeek Pilot: Show Logs` |

## Model Picker

All four variants remain visible in the Copilot Chat model picker.

- Thinking variants expose a per-model `Thinking Effort` control with `high` and `max`.
- If the provider is visible but not fully configured yet, use `Manage Provider` from the picker or command palette.

## Status Bar

One combined right-aligned item:

```text
$(sparkle) DeepSeek Pilot · 16% ctx · $0.15  $17.07
```

- **Leading icon** signals context-window state: sparkle (healthy) → history (warn) → warning (critical), with the background colour shifting to yellow/red at the configured thresholds.
- **`16% ctx`** is the most recent turn's prompt size as a fraction of the model's input window — the actionable "should I compact?" signal.
- **`$0.15`** is the running session cost.
- **`$17.07`** is the platform balance after a refresh.
- **Click** opens the Manage Provider quick pick (set key, refresh balance, context details, cache stats, logs, settings).
- **Hover** shows the full breakdown: model, cache hit %, last turn details, situation-specific compaction advice, session totals, balance, reasoning effort, and the KV-cache primer.

## When to compact your chat (DeepSeek-specific)

VS Code's built-in chat-view context-window widget now reads real BYOK usage (as of VS Code 1.120 — fixing the long-standing [microsoft/vscode#313458](https://github.com/microsoft/vscode/issues/313458)). This extension feeds it via `LanguageModelDataPart.json(usage, "usage")` alongside DeepSeek's `usage` chunk — the bundled Copilot Chat BYOK consumer matches on the literal MIME `"usage"` and expects OpenAI-shape `prompt_tokens` / `completion_tokens` / `total_tokens` (which DeepSeek returns natively). The extension's own status-bar widget stays — it surfaces the DeepSeek-specific signal the built-in widget can't (`cache-hit %`) and the cache-aware compaction advice.

The reason it matters: **DeepSeek caches by prefix**. Every request that shares its leading tokens with a recent request gets those tokens served from disk cache, billed at ~10% of the normal price and skipping the prefill step entirely. A long, stable chat accumulates a high cache-hit rate — the conversation gets *cheaper and faster* as it grows.

Compaction (summarising the chat into a shorter system message) **rewrites the prefix**, which invalidates the cache. The next 1–3 turns then have to rebuild it: every prompt token is a cache miss, first-token latency spikes by seconds, and the cost-per-turn jumps by an order of magnitude.

The rules of thumb the widget encodes:

| Window used | Cache hit | Recommendation |
| ----------- | --------- | -------------- |
| < 60% | high | **Keep going.** Compacting now would force the next several turns into full prefill — slower and more expensive than just letting the cache work. |
| 60–80% | any | Consider wrapping up the topic. Compact only if the conversation will continue for many more turns. |
| > 80% | any | **Compact or start a new chat now.** Truncation is imminent and the KV-cache penalty is worth it at this saturation. |
| any | < 30% & growing prompt | Something is invalidating the prefix — typically editing earlier messages, switching models mid-chat, or a randomised system context. Should self-recover within a few turns. |

Adjust thresholds via `deepseek-pilot.contextWarnThreshold` and `deepseek-pilot.contextCriticalThreshold`.

## Configuration

- `deepseek-pilot.reasoningEffort`: default effort for `(thinking)` variants
- `deepseek-pilot.modelIdOverrides`: remap API model IDs for DeepSeek-compatible proxy endpoints
- `deepseek-pilot.baseUrl`: switch between DeepSeek and compatible gateways
- `deepseek-pilot.contextWarnThreshold` / `deepseek-pilot.contextCriticalThreshold`: percent thresholds for the context-window indicator
- `deepseek-pilot.applyProDiscount`: apply the 75% Pro promo to cost estimates (off by default; auto-expires 2026-05-31)
- `deepseek-pilot.debug`: emit verbose diagnostics to the **DeepSeek Pilot** output channel

## Prior art

This extension started life by surveying two earlier MIT-licensed DeepSeek-in-Copilot projects — [Vizards/deepseek-v4-for-copilot](https://github.com/Vizards/deepseek-v4-for-copilot) (vision proxy concept) and [Laurent00TT/deepseek-v4-vscode-chat](https://github.com/Laurent00TT/deepseek-v4-vscode-chat) (balance + spend tracking idea). The current codebase has since been substantially rewritten end-to-end: a separate context-window tracker, persistent reasoning cache, hardened request/sanitisation pipeline, vision-description caching, currency-aware billing, KV-cache-aware compaction guidance, and the model variant set are all original to this project. Thanks to both upstreams for the starting direction.

## Support the project

Free and MIT-licensed. If it helps:

- ★ Star the repo on [GitHub](https://github.com/setsey/deepseek-pilot)
- 💖 [Sponsor on GitHub](https://github.com/sponsors/setsey)
- 🐞 [File issues](https://github.com/setsey/deepseek-pilot/issues) — include the **DeepSeek Pilot: Show Logs** output if you hit something odd

## License

MIT — see the [LICENSE](LICENSE) file.
