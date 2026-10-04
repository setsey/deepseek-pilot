# DeepSeek Pilot — DeepSeek in GitHub Copilot Chat

**Pick DeepSeek V4.1 Flash or V4 Pro from the Copilot Chat model picker — and keep everything Copilot already gives you.** Agent mode, tool calling, MCP servers, custom instructions, skills: all of it keeps working, now running on DeepSeek, with your own API key.

DeepSeek's models are dramatically cheaper than the flagships from OpenAI and Anthropic while staying competitive on coding work — and their prefix-cache pricing means a long, stable chat gets *cheaper and faster* as it grows. Copilot Chat ships generic BYOK support; DeepSeek Pilot adds the DeepSeek-specific layer on top: live session cost and platform balance in the status bar, KV-cache-aware compaction guidance, a per-model thinking-effort control, native image input on the V4.1 Flash variants (with a zero-config vision proxy for the text-only ones), and one-click wiring as Copilot's hidden utility model.

Requires **VS Code 1.120+** and the GitHub Copilot Chat extension.

> **Model lineup:** DeepSeek's flagship is now **V4.1 Flash** (`deepseek-flash`), which absorbed the experimental vision model — image input is native on Flash. **V4 Pro** (`deepseek-v4-pro`) remains its own model at its own price: DeepSeek withdrew the Pro-to-Flash routing it had announced for 2026-09-14. The earlier `deepseek-chat` / `deepseek-reasoner` names retired on 2026-07-24, and `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` are retired-but-routed to V4.1 Flash; this extension targets the live ids directly.

## Why DeepSeek Pilot

- **Don't replace Copilot — power it up.** No new sidebar, no second chat UI to learn. Just a new model in the picker you already use, so agent mode, tool calling, MCP, `.instructions.md`, `AGENTS.md`, and skills all keep working — now on DeepSeek.
- **See what you're spending.** Real per-session cost in your account currency (USD/CNY auto-detected), live DeepSeek platform balance, cache-hit rate, and token counts — right in the status bar, not buried in a log.
- **Spend the cache, not your money.** DeepSeek bills a long, stable chat at the ~90%-cheaper cache-hit rate. The status bar tells you exactly when compacting would *cost* you more than it saves — guidance a generic BYOK widget can't give.
- **BYOK, pay DeepSeek directly.** Your key, your bill, your rate limits — stored in the OS keychain, never in `settings.json` or your Git history.

## What you get

- **Everything Copilot does, on DeepSeek** — because this registers as a native Copilot model provider, agent mode, tool calling, MCP servers, custom instructions, and skills all work unchanged. Switch models mid-chat without losing history.
- **Four model variants in the picker** — V4.1 Flash and V4 Pro, each with thinking / non-thinking modes, grouped under one **DeepSeek** row. Thinking variants expose a per-model **Thinking Effort** (low / high / max) control.
- **Native image input on the V4.1 Flash variants** — attachments go to DeepSeek's multimodal flagship (`deepseek-flash`) as real pixels, capped at 1,024 tokens per image.
- **Images work on the text-only Pro variants too, zero-config** — a describer model summarises each attachment so Pro can reason over the content. By default that describer is DeepSeek's own multimodal model via your existing API key; point `deepseek-pilot.visionModel` at any host model to override. Descriptions are cached by image hash, so the same screenshot never re-bills.
- **A `#viewImage` tool for image files on disk** — Copilot sends dragged-in files, `#file:` mentions, and Add Context attachments to the model as a *path*, not as pixels, so the model can name an image it cannot see. This tool closes that gap: in agent mode the model calls it with the path (or you reference `#viewImage` yourself) and the actual image enters the conversation — natively on the V4.1 Flash variants, as a described summary on Pro. Images returned by any other tool (MCP screenshot tools, for example) now flow through the same pipeline instead of being dropped.
- **Live context-window indicator, DeepSeek-aware** — status-bar item showing `% of window used · cache-hit %` with KV-cache-aware guidance ("keep going, your cache is healthy" vs. "compact now"). Configurable thresholds.
- **Real session cost & platform balance** — token counts, running spend in your account currency (USD / CNY auto-detected from the DeepSeek API), and a one-click balance refresh. **Peak/off-peak aware:** DeepSeek bills on a time-of-day schedule (peak 01:00-04:00 and 06:00-10:00 UTC on weekdays, everything else — including weekends and Chinese public holidays — at half price), so both the cost estimate and the model picker quote the rate actually in force and name the tier.
- **Persistent reasoning cache** — reasoning traces from thinking variants are fingerprinted, persisted across VS Code restarts, and replayed during multi-turn agent loops so DeepSeek's KV cache stays warm.
- **Wire as Copilot's utility + utility-small models** — two one-click commands route Copilot's background flows (chat titles, summaries, commit messages, intent detection — plus the lightweight fast-path slot Copilot Chat 1.121 exposes) through DeepSeek Flash, where the dollar cost is negligible. With neither slot set, VS Code's `chat.byokUtilityModelDefault` decides where those flows go while a DeepSeek model is the active chat model: GitHub Copilot's own utility models (`copilot`, the default), the active DeepSeek model (`mainAgent`), or nowhere (`none`).
- **Production-grade request pipeline** — schema sanitisation, tool-call / tool-result pairing, mid-stream truncation detection, retry on transient failures, automatic thinking-off for Copilot's background utility requests (titles, commit messages) so reasoning tokens aren't spent on them, thinking-off for requests that force a tool call (DeepSeek rejects a required `tool_choice` in thinking mode), and debug-only cache-trace snapshots for diagnosing odd 400s without leaking message content.
- **Friendly setup** — variants stay visible in the picker before an API key is configured (with a warning icon), and key validation probes the configured endpoint before saving, with a fall-through path for proxy tokens that can't be validated upstream.

## Compared to the alternatives

| | DeepSeek Pilot | Local proxy (e.g. LiteLLM) | Standalone DeepSeek extension |
| --- | --- | --- | --- |
| Works inside Copilot Chat | Yes | Yes | No — separate UI |
| Copilot agent mode, tools, MCP, skills | Yes | Yes | Reimplemented, partial |
| Vision / image attachments | Yes — native on V4.1 Flash, proxied on Pro | No | No |
| Image files on disk (`#viewImage` tool) | Yes — any variant, agent mode included | No | No |
| Live cost, balance & cache-hit in the status bar | Yes | No | Varies |
| KV-cache-aware compaction guidance | Yes | No | No |
| Per-session spend in your account currency | Yes | No | No |
| No extra process to run | Yes | No | Yes |
| API key in the OS keychain | Yes | No | Varies |
| One-click install | Yes | No | Yes |

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

- Thinking variants expose a per-model `Thinking Effort` control with `low`, `high`, and `max`.
- The V4.1 Flash pair reads image attachments natively; the Pro variants describe them via the vision proxy.
- For an image that exists as a *file* rather than an attachment, reference `#viewImage` in the prompt (or let agent mode call it) — attaching a file by drag-in or `#file:` only hands the model its path.
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
- **Hover** shows the full breakdown: model, cache hit %, last turn details, situation-specific compaction advice, whether DeepSeek's peak or off-peak rate is currently in force, session totals, balance, reasoning effort, and the KV-cache primer.

## When to compact your chat (DeepSeek-specific)

VS Code's built-in chat-view context-window widget now reads real BYOK usage (as of VS Code 1.120 — fixing the long-standing [microsoft/vscode#313458](https://github.com/microsoft/vscode/issues/313458)). This extension feeds it via `LanguageModelDataPart.json(usage, "usage")` alongside DeepSeek's `usage` chunk — the bundled Copilot Chat BYOK consumer matches on the literal MIME `"usage"` and expects OpenAI-shape `prompt_tokens` / `completion_tokens` / `total_tokens` (which DeepSeek returns natively) plus `prompt_tokens_details.cached_tokens` (passed through when DeepSeek sends it, otherwise filled from DeepSeek's `prompt_cache_hit_tokens`). The extension's own status-bar widget stays — it surfaces the DeepSeek-specific signal the built-in widget can't (`cache-hit %`) and the cache-aware compaction advice.

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
- `deepseek-pilot.optimizeUtilityRequests`: auto-disable thinking on Copilot's background utility requests (titles, commit messages) when a thinking variant is active; default on
- `deepseek-pilot.modelIdOverrides`: remap API model IDs for DeepSeek-compatible proxy endpoints
- `deepseek-pilot.visionModel`: describer model for image attachments on the text-only variants; empty (default) = DeepSeek's own vision model via your API key
- `deepseek-pilot.baseUrl`: switch between DeepSeek and compatible gateways
- `deepseek-pilot.contextWarnThreshold` / `deepseek-pilot.contextCriticalThreshold`: percent thresholds for the context-window indicator
- `deepseek-pilot.debug`: emit verbose diagnostics to the **DeepSeek Pilot** output channel

## Prior art

This extension started life by surveying two earlier MIT-licensed DeepSeek-in-Copilot projects — [Vizards/deepseek-v4-for-copilot](https://github.com/Vizards/deepseek-v4-for-copilot) (vision proxy concept) and [Laurent00TT/deepseek-v4-vscode-chat](https://github.com/Laurent00TT/deepseek-v4-vscode-chat) (balance + spend tracking idea). The current codebase has since been substantially rewritten end-to-end: a separate context-window tracker, persistent reasoning cache, hardened request/sanitisation pipeline, vision-description caching, currency-aware billing, KV-cache-aware compaction guidance, and the model variant set are all original to this project. Thanks to both upstreams for the starting direction.

## Support the project

Free and MIT-licensed. If it helps:

- Star the repo on [GitHub](https://github.com/setsey/deepseek-pilot)
- [Sponsor on GitHub](https://github.com/sponsors/setsey)
- [File an issue](https://github.com/setsey/deepseek-pilot/issues) — include the **DeepSeek Pilot: Show Logs** output if you hit something odd

## License

MIT — see the [LICENSE](LICENSE) file.
