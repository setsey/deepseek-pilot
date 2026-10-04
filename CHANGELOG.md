# Changelog

All notable changes to **DeepSeek Pilot** are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.0] — 2026-10-04

Re-verification pass against DeepSeek's live API ([pricing](https://api-docs.deepseek.com/quick_start/pricing), its [zh-cn counterpart](https://api-docs.deepseek.com/zh-cn/quick_start/pricing), the [change log](https://api-docs.deepseek.com/updates), the [API reference](https://api-docs.deepseek.com/api/create-chat-completion), and the [vision](https://api-docs.deepseek.com/guides/vision) and [thinking-mode](https://api-docs.deepseek.com/guides/thinking_mode) guides, all read 2026-10-04) and the current host (VS Code 1.140). The headline: DeepSeek **withdrew** the V4 Pro to V4.1 Flash routing it had announced for 2026-09-14 and kept serving Pro "with the billing method remaining unchanged". v0.8.0 had already date-gated that switch, so since 2026-09-14 it has been estimating Pro requests at Flash prices. This release also completes the Chinese interface, contributed by [@XiaoZ-0218](https://github.com/XiaoZ-0218) ([#2](https://github.com/setsey/deepseek-pilot/pull/2)).

### Fixed
- **DeepSeek V4 Pro cost estimates were 3.3x to 7.3x too low from 2026-09-14.** The status bar, picker hint, and native cost slots billed Pro at the Flash card ($0.30 / $1.20 per Mtok cache-miss / output at peak) instead of Pro's own ($1.32 / $3.96; cache-hit $0.044 vs $0.006). The cutover gate is removed and Pro always bills its own row, in USD and CNY.
- **Thinking variants no longer 400 when the host forces a tool call.** DeepSeek rejects `tool_choice: "required"` and named-tool choices in thinking mode. When the host passes `LanguageModelChatToolMode.Required` (for example Copilot's prompt categorizer, if a thinking variant serves it), the request is now sent with thinking off; ordinary agent turns, which use `tool_choice: "auto"`, keep thinking on. The log line `[req] host requires a tool call` marks it.
- **Chinese public holidays bill off-peak, and now show as off-peak.** The pricing page excludes them from peak hours (周一至周五（不含中国法定节假日）). The 2026 State Council schedule is built in, so this week's National Day holiday (Oct 5-7) and every other 2026 holiday weekday report the off-peak tier and rate. Weekend make-up workdays stay off-peak, as the page bills every weekend hour off-peak.
- **Image token estimates on the V4.1 Flash variants.** DeepSeek now bounds each image at 1,024 tokens (images are resized to roughly 1300x1300 total pixels before inference), up from the 384 the estimator assumed, so the context-window indicator and prompt budgeting under-counted image-heavy chats.

### Changed
- The V4 Pro picker descriptions drop "served by V4.1 Flash from 2026-09-14" and now say images go through the vision proxy.
- The peak schedule in the status-bar and picker tooltips reads "Mon-Fri, excl. Chinese public holidays".
- The README documents VS Code's `chat.byokUtilityModelDefault` setting, which decides where Copilot's utility flows run while a DeepSeek model is active and neither utility slot is set: Copilot's own models (the default), the active DeepSeek model, or nowhere.
- A `finish_reason` of `aborted` (a generation DeepSeek interrupted server-side) is now logged alongside the other truncation reasons.
- CI now runs the test suite on every push and pull request; it previously ran lint, compile, and package only.
- Host contracts re-verified against VS Code 1.140: the language-model section of the stable API is unchanged since 1.137, the `usage` MIME and `cached_tokens` contract still hold (DeepSeek now documents `prompt_tokens_details.cached_tokens` natively and it passes through untouched), the utility-request markers still match Copilot's current prompts, and `languageModelThinkingPart` is still a proposed API.

### Added
- **Chinese (zh-cn) translations for the rest of the interface** — the status-bar tooltip, the model-picker tooltip and rate hint, the context-window headlines and advice, the KV-cache primer, the compaction-details dialog, the thinking-effort control, and the utility-model quick pick. English output is unchanged. Contributed by [@XiaoZ-0218](https://github.com/XiaoZ-0218) ([#2](https://github.com/setsey/deepseek-pilot/pull/2)).
- Specs for the holiday tier, Pro billing after 2026-09-14, and the forced-tool-call thinking rule. The suite is now 88.

## [0.8.0] — 2026-09-10

Re-verification pass against DeepSeek's live API ([pricing](https://api-docs.deepseek.com/quick_start/pricing), its [zh-cn counterpart](https://api-docs.deepseek.com/zh-cn/quick_start/pricing), and the [API reference](https://api-docs.deepseek.com/api/create-chat-completion), all read 2026-09-10) and the current host (VS Code 1.137.0 with Copilot Chat 0.65.0). DeepSeek shipped **V4.1 Flash** as its new flagship under the model id `deepseek-flash`: it is natively multimodal (absorbing the experimental `deepseek-v4-flash-vision-exp`), cheaper than V4 Flash, and replaces V4 Pro too — from **2026-09-14 04:00 UTC** DeepSeek serves `deepseek-v4-pro` requests with V4.1 Flash and bills them at the Flash price. The legacy `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` ids remain accepted but are routed the same way. Peak billing hours also became weekday-only.

### Changed
- **Model lineup goes from six variants to four** — `DeepSeek V4.1 Flash` and `DeepSeek V4.1 Flash (thinking)` (API id `deepseek-flash`, native image input) plus the existing `DeepSeek V4 Pro` pair. The separate Flash Vision pair is gone because the capability moved into Flash itself. The Pro pair keeps the `deepseek-v4-pro` id — DeepSeek serves it via V4.1 Flash from 2026-09-14, and keeping the id means it upgrades in place if a V4.1 Pro ships behind it; its picker description states the routing. The picker row is now labeled **DeepSeek** (previously DeepSeek V4). A previously selected Flash or Flash Vision variant must be re-picked once, since those ids changed.
- **Flash rates cut to the published V4.1 card** — peak cache-miss $0.44 to $0.30, output $1.32 to $1.20, cache-hit $0.014 to $0.006 per Mtok (CNY ¥3/¥9/¥0.1 to ¥2/¥8/¥0.04); off-peak remains exactly half. Pro's own rates are unchanged but apply only until the 2026-09-14 cutover — `getRates` date-gates the switch, so cost estimates bill Pro requests at the Flash price from the moment DeepSeek does.
- **Peak hours are now Monday-Friday only** (01:00-04:00 and 06:00-10:00 UTC; the zh-cn page's 周一至周五 09:00-12:00 / 14:00-18:00 Beijing time is the same window). Weekends bill entirely off-peak, and the tier check, picker hints, and status-bar rate line all reflect it. The UTC day-of-week test is exact because both peak windows fall where the UTC and Beijing calendar days coincide.
- **The zero-config vision describer now calls `deepseek-flash`** instead of the retired vision-exp id.
- **`deepseek-pilot.modelIdOverrides` slots follow the live ids** — a `deepseek-flash` slot (which also covers the built-in vision describer) replaces the `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` slots. Proxy users who had either old slot set should re-key it to `deepseek-flash`.
- The utility-model wiring commands recommend the V4.1 Flash variants, and the utility-request markers are refreshed for Copilot Chat 0.65's reworded prompts (chat titles, history compaction) while keeping the older wordings for hosts back to 1.120. Copilot Chat 0.65's prompt categorizer now calls a forced tool, so the no-tools gate skips it by design — it runs on the utility-small slot, not the active model.

### Fixed
- Host contracts re-verified against Copilot Chat 0.65.0: the `usage` MIME contract, the `cached_tokens` mapping, and the `chat.utilityModel` / `chat.utilitySmallModel` value format are all unchanged and keep working; `languageModelThinkingPart` is still a proposed API in VS Code 1.137, so the runtime feature-detection and text fallback remain the shipping path. The `engines.vscode` 1.120 floor stays — the stable API is unchanged through 1.137 apart from doc comments.

### Added
- Specs for the weekday-aware rate tier, the V4.1 Flash rate card in both currencies, the Pro-to-Flash billing cutover, and the Copilot Chat 0.65 utility-prompt wordings. The suite is now 81.

## [0.7.1] — 2026-09-04

### Fixed
- **Agent-mode 400 on the Flash Vision variants when the model makes parallel tool calls** — `An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'`. v0.7.0 hoisted a tool-result image into a user message emitted right after that result's tool message; with parallel tool calls the host feeds results back across several messages, so the early user message split the tool-response block the API requires to be contiguous. Hoisted images are now buffered and released into the first user content emitted after every open tool call has been answered. An image in a history that ends mid-tool-loop is dropped with a logged warning instead of invalidating the whole request, and an orphan tool result no longer contributes an image at all.

### Added
- 4 specs covering the parallel-tool-call sequences (split results, image-only closing result, mid-loop history, orphan results). The suite is now 76.

## [0.7.0] — 2026-09-04

Copilot Chat only delivers real image data for images attached directly to the chat. A file referenced any other way — dragged into the prompt, mentioned with `#file:`, added via Add Context, or encountered by the agent on disk — reaches the model as a path string, so the model can name an image it cannot see. This release adds the missing piece: a tool that turns a path back into pixels, plus full handling for images returned by tools.

### Added
- **`#viewImage` language-model tool** (`deepseek-pilot_viewImage`). The model — or the user, via `#viewImage` in the prompt — passes an absolute path, workspace-relative path, or `file://` URI of a png/jpg/jpeg/webp/gif/bmp file and receives the actual image. Available in agent mode; missing files, unsupported types, and files over DeepSeek's size cap return an explanatory text result the model can act on. Registered tools are host-global, so other vision-capable models can use it too.
- **Images inside tool results are now processed instead of dropped.** Any tool that returns an image (the new viewImage tool, MCP screenshot tools) works on every variant: the Flash Vision pair receives the pixels inline — hoisted into the following user message, since the API rejects images in the `tool` role — and the text-only Pro/Flash variants receive a vision-proxy description in place.
- 16 specs covering the tool (path resolution, mime mapping, guard rails) and the two tool-result image paths. The suite is now 72.

### Fixed
- A tool result whose only content was a data part could have its raw byte array JSON-dumped into the prompt (megabytes of `{"0":137,...}` for an image). Non-text data parts in tool results now collapse to a short placeholder.

## [0.6.0] — 2026-09-03

DeepSeek released its first multimodal model, **`deepseek-v4-flash-vision-exp`**, on 2026-08-21 ([release note](https://api-docs.deepseek.com/news/news260821)) — four days after v0.5.0 shipped. This release adopts it on both fronts: as a pair of picker variants that read images natively, and as the new zero-config default for the vision proxy that serves the text-only variants. Pricing, model IDs, effort levels, and context limits were re-verified against the live docs on 2026-09-03 and are unchanged.

### Added
- **Two native-vision picker variants** — `DeepSeek V4 Flash Vision` and `DeepSeek V4 Flash Vision (thinking)`. Image attachments are sent to DeepSeek inline (base64 `image_url` content parts) instead of being paraphrased by a describer model, so the model sees the actual pixels. Billed at Flash rates; DeepSeek converts each image to at most 384 tokens. Both variants join the existing four under the **DeepSeek V4** picker row with an eye icon. DeepSeek labels the model experimental, and the variant descriptions say so.
- **The vision proxy is now zero-config.** With no `deepseek-pilot.visionModel` configured, image descriptions for the text-only Pro/Flash variants are produced by DeepSeek's own vision model over your existing API key — no second provider, no host model lookup, and no `vscode.lm` consent dialog. A configured setting still wins, and the old auto-detection of a non-DeepSeek host model remains as the final fallback. The `Set Vision Proxy Model` picker gains a **DeepSeek built-in** entry at the top.
- Native-vision guard rails: images are only sent in user messages (the API 400s on any other role), and an image whose base64 form would exceed DeepSeek's 32 MiB per-image cap is dropped with a logged warning instead of failing the whole request.
- Token estimates for the vision variants count each image at the API's 384-token cap, so the context-window indicator and prompt budgeting stay honest for image-heavy chats.
- 8 specs covering the native-vision message conversion and the vision model's Flash-rate billing. The suite is now 56.

### Changed
- The `deepseek-pilot.modelIdOverrides` setting gains a `deepseek-v4-flash-vision-exp` slot for proxy endpoints that remap the vision model.
- The README/Marketplace framing no longer describes DeepSeek as text-only — it hasn't been since 2026-08-21.

## [0.5.0] — 2026-08-17

Re-verification pass against the live DeepSeek V4 API ([pricing](https://api-docs.deepseek.com/quick_start/pricing), its [zh-cn counterpart](https://api-docs.deepseek.com/zh-cn/quick_start/pricing), and the [change log](https://api-docs.deepseek.com/updates), all read 2026-08-17). DeepSeek moved to peak/off-peak billing on **2026-08-16 16:00 UTC** and added a third reasoning-effort level when V4-Pro went GA on **2026-08-13**; both landed after the v0.4.3 check on 2026-07-25. Model IDs, the 1M-token shared window, and the 384K output ceiling are confirmed unchanged.

### Fixed
- **Cost estimation understated real spend by 1.5x to 4.7x.** The extension carried a flat rate card (Pro at $0.435 cache-miss / $0.87 output per Mtok, Flash at $0.14 / $0.28), which DeepSeek replaced on 2026-08-16 with peak and off-peak columns: Pro is now $0.66 / $1.98 off-peak and $1.32 / $3.96 at peak, Flash $0.22 / $0.66 and $0.44 / $1.32. The old figures sat below even the off-peak column, so the status bar, the model picker, and the native cost slots all under-reported — most severely during peak hours. CNY rates are updated to match the zh-cn page (Pro ¥4.5 / ¥13.5 off-peak, ¥9 / ¥27 at peak; Flash ¥1.5 / ¥4.5 and ¥3 / ¥9).
- **The `low` reasoning effort was unreachable.** DeepSeek V4 accepts `low`, `high`, and `max`; the extension folded a host-supplied `low` into `high` and offered only two levels in the picker and the `deepseek-pilot.reasoningEffort` setting, so the cheapest thinking mode could not be selected at all. All three levels are now exposed. `medium` still maps to `high` and `xhigh` to `max`, since neither is a DeepSeek value — the `xhigh` mapping matches the one DeepSeek publishes for its own Oh My Pi integration.

### Added
- **Peak/off-peak awareness throughout.** Rates are resolved from the clock at the moment they are used, so cost estimates bill each request at the tier that was actually in force. Peak is 01:00-04:00 and 06:00-10:00 UTC; off-peak is exactly half price and covers every other hour, including the 04:00-06:00 UTC gap between the two peak windows.
- The model picker's `detail` line and tooltip now name the current tier alongside the price, for example `Pro · thinking · $0.66/$1.98 per Mtok in/out · off-peak`. Because the two tiers differ by 2x, the figure is stamped per picker query rather than baked in at startup, so it cannot go stale in a long-running window.
- The status-bar tooltip gains a **Rate** line showing the tier in force and the peak schedule.
- 14 specs covering the rate table cell-for-cell against both currency pages, the peak-window boundaries, and price-string formatting. The suite is now 48.

### Changed
- Pricing consolidated into a new [`src/pricing.ts`](src/pricing.ts). It previously lived in two places that had to be kept in step by hand — a `PRICING` table in `src/provider/balance.ts` for cost computation and a separate `PRICE_USD` table in `src/consts.ts` for the picker hints — which is how the picker came to be 4x wrong in v0.3.0. Only the peak column is stored; off-peak is derived by halving, which is exact in binary floating point and matches the published off-peak column.

## [0.4.3] — 2026-07-25

Re-verification pass against the live DeepSeek V4 API ([api-docs.deepseek.com](https://api-docs.deepseek.com/zh-cn/), checked 2026-07-25) and the current host (VS Code 1.130 with Copilot Chat 0.58.0). Model IDs, the 1M-token shared window, the 384K output ceiling, and all six pricing figures are confirmed unchanged. One host contract had drifted.

### Fixed
- **Copilot's native cached-token readout no longer reports zero on a prefix-cache hit.** The host normalizes the `usage` data part's `prompt_tokens_details.cached_tokens` with a `?? 0` fallback, but DeepSeek reports cache hits as `prompt_cache_hit_tokens` and never sends `prompt_tokens_details` — so passing its usage object through verbatim pinned the host's figure at 0 even when the whole prompt was served from cache. `stream.ts` now maps one field onto the other on the way out. The status-bar cache-hit % was always computed from the raw DeepSeek fields and was unaffected.

### Changed
- The legacy `deepseek-chat` / `deepseek-reasoner` model names reached their **2026-07-24** retirement, so the README and developer guide now describe the sunset as done rather than upcoming. This extension has always targeted `deepseek-v4-pro` / `deepseek-v4-flash` and needed no code change.
- Development toolchain refreshed: TypeScript 7.0.2, oxlint 1.75, oxfmt 0.60, `@vscode/vsce` 3.9.2, `@types/node` 25.9. Transitive advisories in the build tooling are cleared (`npm audit` reports 0); the extension ships no runtime dependencies, so none of them ever reached an installed copy.
- `engines.vscode` and `@types/vscode` stay pinned at 1.120. The stable extension API is byte-identical between 1.120 and 1.125 apart from a doc-comment reorder, so raising the floor would narrow the installable base for no gain — the reasoning is recorded in the developer guide.

### Added
- Five specs covering the usage-shape translation, bringing the suite to 34.

## [0.4.2] — 2026-06-18

### Changed
- Removed the hard `extensionDependencies` on `github.copilot-chat`, which could block Remote-SSH / WSL / Dev-Container sessions from activating the extension. GitHub Copilot Chat is still required — install it from the Marketplace if you don't already have it (the walkthrough and README cover this); it is simply no longer pulled in as an auto-installed dependency.

## [0.4.1] — 2026-06-18

### Documentation
- Note in the README and Marketplace listing that DeepSeek retires the legacy `deepseek-chat` / `deepseek-reasoner` model names on 2026-07-24 (until then they resolve to V4 Flash). This extension already targets `deepseek-v4-pro` / `deepseek-v4-flash`, so it is unaffected and exposes Pro as well as Flash.

## [0.4.0] — 2026-06-18

Aligns the provider with the current DeepSeek V4 API (re-verified against [api-docs.deepseek.com](https://api-docs.deepseek.com/) on 2026-06-18) and adds two cost/quality features. The `deepseek-v4-pro` / `deepseek-v4-flash` model IDs this extension targets are confirmed current; the legacy `deepseek-chat` / `deepseek-reasoner` IDs are deprecated and retire 2026-07-24, so this extension is unaffected by that sunset.

### Added
- **Auto-disable thinking on Copilot's utility flows.** When a `(thinking)` variant is the active model, lightweight Copilot requests (chat titles, commit messages, branch names, rename suggestions, prompt categorization) are detected by their system-prompt signature and sent with thinking off — saving reasoning tokens and latency on work that gets no benefit from extended reasoning. Gated to the official endpoint; the agentic loop (which carries tools) is never affected. Controlled by the new `deepseek-pilot.optimizeUtilityRequests` setting (default on) and logged when it fires. See [`src/provider/request-kind.ts`](src/provider/request-kind.ts).
- **Native price display in the model picker.** Each variant now carries `inputCost` / `outputCost` / `cacheCost`, so DeepSeek's per-Mtok prices render in Copilot's native cost slots in addition to the existing `detail` hint.
- **Clearer network-error guidance.** A connection failure now surfaces a single actionable message (with the underlying error code) pointing at the network, any VPN/proxy, and the `deepseek-pilot.baseUrl` setting, instead of a raw `fetch failed`.

### Changed
- **Context-window sizes corrected to DeepSeek V4's documented limits** — a 1M-token shared window (input + output ≤ 1,048,576) with a 384K output ceiling. Thinking variants are now 655,360 in / 393,216 out (previously 720,896 / 262,144, which under-reported both the input budget and the real reasoning-output ceiling); non-thinking variants are 983,040 in / 65,536 out.
- **Per-request timeout raised from 5 to 10 minutes** to match DeepSeek's own connection policy, so a slow-but-healthy max-effort reasoning stream is no longer truncated client-side.
- **`LanguageModelChatToolMode.Required` with multiple tools** now sends `tool_choice: "required"` instead of erroring; a single required tool still maps to a named choice.
- **`frequency_penalty` / `presence_penalty` are no longer sent** — the DeepSeek V4 API dropped support for them. Host-supplied `temperature` / `top_p` are clamped to the documented ranges and `stop` is capped at 16 sequences.

### Fixed
- **Model picker overstated DeepSeek V4 Pro's price 4x** — it showed `$1.74/$3.48` per Mtok (the pre-discount rate) instead of the current `$0.435/$0.87`. Cost estimation in the status bar was already correct; only the picker hint was stale.
- **Tool calls whose names require sanitization** (for example MCP tools such as `server.tool`) are now routed back to the host under their original name, so agent-mode tool invocation works for them. Previously the sanitized name was emitted and the host could not match it to the tool it registered.

## [0.3.0] — 2026-06-02

Adds a full Chinese (Simplified) interface. The extension now follows VS Code's display language: set it to Chinese and the commands, settings, Manage Provider menu, dialogs, notifications, and getting-started walkthrough appear in Chinese; English stays the default everywhere else.

### Added

- **Chinese (`zh-cn`) localization** of the entire user-facing surface — the 13 commands, every setting description, the Manage Provider quick-pick, the API-key and reasoning-cache dialogs, error notifications, the streaming "thinking" hint, and the four walkthrough steps. Built on VS Code's manifest NLS (`package.nls.json` / `package.nls.zh-cn.json`) and the `vscode.l10n` runtime bundle (`l10n/bundle.l10n.json` / `l10n/bundle.l10n.zh-cn.json`); no new dependencies, and English is unchanged. Original translation contributed by [@XiaoZ-0218](https://github.com/XiaoZ-0218) ([#1](https://github.com/setsey/deepseek-pilot/pull/1)).

## [0.2.2] — 2026-05-25

### Changed
- **V4-Pro pricing baked in as permanent.** DeepSeek announced on **2026-05-22** that the previously-promotional 75% off on `deepseek-v4-pro` is now the permanent regular price ("It is officially set to 1/4 of the original price!" — confirmed by Bloomberg, Engadget, the-decoder, DataConomy). Cost estimation now uses the new figures directly: cache-hit $0.003625/M, cache-miss $0.435/M, output $0.87/M (USD); ¥0.025/M, ¥3.0/M, ¥6.0/M (CNY).
- **V4-Flash cache-hit dropped to 1/10 of cache-miss**, effective **2026-04-26 12:15 UTC** (per DeepSeek's cache-pricing announcement; this change applies to all models — Pro's cache-hit was already at 1/12, the new 1/10 ratio means Flash's hit dropped from $0.028 to $0.0028/M while miss + output stayed at $0.14 / $0.28 per M). CNY mirrors at ¥0.02 / ¥1.0 / ¥2.0.
- Status-bar tooltip no longer renders the "Pro 75% discount available until …" line — the discount is the price.

### Removed
- **`deepseek-pilot.applyProDiscount` setting** plus the date-gated `PRO_DISCOUNT_END_UTC` / `PRO_DISCOUNT_FACTOR` logic in `src/provider/balance.ts`. The opt-in toggle is unnecessary now that the discounted rates are the regular rates. Users who had it set in their settings.json will see VS Code mark it as "Unknown configuration setting" — safe to delete the line; the cost estimator will use the new rates either way.
- `getApplyProDiscount()` helper in `src/config.ts`.
- `applyProDiscount` entry from the one-shot `deepseek-qa.*` → `deepseek-pilot.*` migration list in `src/migrate.ts` (the old namespace is long gone, but tidy is tidy).

## [0.2.1] — 2026-05-23

### Fixed
- VS Code 1.120's built-in chat-view context-window widget now reflects real usage after each turn. The earlier `application/vnd.llm.usage+json` MIME on the `LanguageModelDataPart` was speculative — the bundled Copilot Chat BYOK consumer matches on the literal MIME `"usage"` and silently dropped anything else, leaving the widget pegged at `0 / <window>` indefinitely.

### Changed
- `DSUsage` type now declares `total_tokens?` to match DeepSeek's response surface (the BYOK consumer requires the field).

## [0.2.0] — 2026-05-23

First public-facing release after a substantial rewrite. Original code surveyed two MIT-licensed prior-art projects ([Vizards/deepseek-v4-for-copilot](https://github.com/Vizards/deepseek-v4-for-copilot), [Laurent00TT/deepseek-v4-vscode-chat](https://github.com/Laurent00TT/deepseek-v4-vscode-chat)) — both credited in the README.

### Added
- Modernization for VS Code 1.120 / 1.121: registration via `languageModelChatProviders`, `LanguageModelDataPart` sidecar for usage, per-variant `detail` / `tooltip` / `statusIcon` metadata, `toolCalling: 128`, `imageInput`, and a BYOK context-window widget feed.
- Wire as Copilot's utility model: one-click commands set `chat.utilityModel` / `chat.utilitySmallModel` to a DeepSeek Flash variant for background flows (titles, summaries, commit messages, intent detection).
- KV-cache-aware compaction guidance rendered in the status-bar tooltip and a dedicated **Show Context Window Details** view.
- Persistent reasoning cache (`reasoning_content` fingerprinted, replayed across multi-turn agent loops, survives VS Code restarts) with a **Clear Reasoning Cache** diagnostic command.
- Vision proxy with per-image-hash description caching so the same screenshot doesn't re-cost on every turn.
- Currency-aware billing: USD / CNY auto-detect from `user/balance`, with a 75% Pro promo opt-in that auto-expires 2026-05-31.
- One-shot migration shim ([`src/migrate.ts`](src/migrate.ts)) that ports API key, reasoning cache, welcome flag, and settings from the previous `deepseek-qa.*` namespace on first activation.

### Changed
- Renamed from `deepseek-v4-qa` → `deepseek-pilot` across npm package, publisher, vendor, command IDs, setting keys, secret key, and global-state keys. The migration shim handles existing installs transparently.
