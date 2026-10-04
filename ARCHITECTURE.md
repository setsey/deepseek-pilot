# DeepSeek Pilot — Developer Guide

## Overview

VS Code extension that registers DeepSeek models (V4.1 Flash / V4 Pro × thinking/non-thinking) as `LanguageModelChatProvider` for GitHub Copilot Chat. Merges vision proxy from [deepseek-v4-for-copilot](https://github.com/Vizards/deepseek-v4-for-copilot) and balance/token tracking from [deepseek-v4-vscode-chat](https://github.com/Laurent00TT/deepseek-v4-vscode-chat).

- **Language**: TypeScript 6, target ES2022, NodeNext modules
- **VS Code API**: `^1.120.0` (uses `LanguageModelChatProvider`, `LanguageModelDataPart`, `chat.utilityModel`, BYOK context window widget)
- **Runtime**: Node ≥24

## Architecture

```text
src/
├── extension.ts          # Activation, commands, status bar, walkthrough
├── auth.ts               # API key storage via secrets API + validation
├── config.ts             # Workspace configuration readers
├── consts.ts             # Model definitions, MIME constants, IDs, utility-model setting keys
├── pricing.ts            # Peak/off-peak rate table, tier resolution, picker price strings
├── json.ts               # tryParseJson, safeJsonStringify
├── logger.ts             # Output channel logger (debug gated by setting)
├── types.ts              # OpenAI/DeepSeek API types (DSBalance, DSUsage, etc.)
├── utility-model.ts      # `chat.utilityModel` wiring (Copilot Chat 1.121 utility-model slots)
├── tools/
│   └── view-image.ts     # #viewImage LM tool — loads an image file from disk into the chat
└── provider/
    ├── index.ts          # DeepSeekChatProvider — main LM provider class
    ├── balance.ts        # BalanceTracker — cost estimation, status bar, session spend
    ├── cache.ts          # ReasoningCache — persistent reasoning_content across turns
    ├── convert.ts        # VS Code messages → OpenAI/DeepSeek format
    ├── diagnostics.ts    # Debug-only cache-trace logging (role sequences, hashes)
    ├── errors.ts         # API error formatting, retry logic, user notifications
    ├── models.ts         # Model info → LanguageModelChatInformation
    ├── request.ts        # Request preparation (auth, body, vision resolution)
    ├── sanitize.ts       # Tool schema sanitization for DeepSeek API constraints
    ├── stream.ts         # SSE streaming, tool call buffering, usage emission
    ├── tokens.ts         # estimateTokenCount (character-based, duck-typed parts)
    ├── validate.ts       # Pre-flight message sequence validation
    └── vision/
        ├── index.ts      # Barrel exports
        ├── model.ts      # Vision proxy model selection
        └── resolve.ts    # Image→description resolution with cache
```

## Key Patterns

### Duck Typing for API Boundary Parts

In `tokens.ts`, `estimatePartChars()` uses **duck typing** (checking `mimeType`, `callId`, `value` properties) instead of `instanceof`. Reason: Copilot Chat calls `provideTokenCount` across VS Code's API proxy boundary, so parts arrive as plain objects without their class prototype. `instanceof` checks always fail there.

However, `convert.ts` and `validate.ts` DO use `instanceof` because they're called during request preparation inside the extension process.

### Reasoning Cache

- `ReasoningCache` persists `reasoning_content` across VS Code restarts via `globalState`
- Cache key = SHA-256 fingerprint of `(assistant_text, tool_call_ids_and_names)`
- In thinking mode, every assistant turn must carry `reasoning_content` (even empty `""`) once tool calls have been emitted — missing it causes a DeepSeek 400
- Cache hit → reuse original reasoning chain; cache miss → `""` fallback
- Eviction: oldest-first when >512 entries or >20 MB total

### Vision: native + proxy

Two image paths, selected by the variant's `nativeVision` flag in `consts.ts`:

- **Native (V4.1 Flash variants):** `convert.ts` emits user-message content as an ordered `{type:"text"}` / `{type:"image_url"}` parts array with images inlined as base64 data URLs. The API only accepts images in `user` messages (anywhere else is a 400) and caps a base64 image at 32 MiB, so images in other roles or over ~24 MiB raw are dropped with a logged warning. Each image bills at most 1,024 tokens (`VISION_IMAGE_TOKEN_CAP`; DeepSeek resizes every image to roughly 1300x1300 total pixels or less before inference); `tokens.ts` and the request char count use that cap, not the base64 length.
- **Proxy (text-only Pro variants):** images are described by a `VisionDescriber` and replaced with `[Image Description: ...]` text. Resolution order in `vision/model.ts`: the `deepseek-pilot.visionModel` setting (a host model) → **DeepSeek's own multimodal Flash model called directly over the API key** (the zero-config default — no host lookup, no `vscode.lm` consent dialog, thinking disabled) → auto-detect of the first non-DeepSeek host model.
- Cache: primary by `(mime + dataHash + visionModel + prompt`), secondary by `dataHash`
- Single-flight deduplication: concurrent same-image lookups share one proxy call
- `provideTokenCount` reads cached descriptions via `dataHash` to estimate image tokens on proxy variants

**Tool-result images** ride the same two paths. Any tool can return a `LanguageModelDataPart` image inside a `LanguageModelToolResultPart` (MCP screenshot tools, the bundled `#viewImage` tool). On proxy variants, `resolve.ts` descends into tool results and replaces nested images with described text (which then flows through `convert.ts`'s existing text filter). On native variants, `convert.ts` **hoists** each tool-result image into the user message that follows the tool message — the vision guide supports images in user messages only (the API reference's tool-message schema now lists image parts too, but a hoisted image is valid under either reading) — with a `[Image returned by tool call <id>]` marker so the model can tie it back, and leaves a note in the tool message when the image was its only content. The `stringifyToolResultContent` fallback collapses any *other* data part to a `[<mime> data omitted ...]` placeholder; JSON-stringifying one would dump its raw byte array into the prompt.

### The `#viewImage` tool

Copilot Chat sends file *references* (drag-in, `#file:`, Add Context) to the model as a path, not as pixels — only true chat attachments arrive as image data parts. `tools/view-image.ts` closes the gap with a `languageModelTools` contribution (`deepseek-pilot_viewImage`, reference name `viewImage`, available to agent mode and `#`-referencable): input is an absolute path, workspace-relative path, or `file://` URI; the tool validates the extension against a mime allow-list, enforces `VISION_IMAGE_MAX_RAW_BYTES` from the stat size *before* reading, and returns a text label plus `LanguageModelDataPart.image(...)`. Failures (missing file, unsupported type, oversized) come back as text results rather than thrown errors so the model can react. Registered tools are host-global, so other vision-capable models in the picker benefit too.

### Tool Call Handling

- `stream.ts` buffers tool call deltas by `index`, flushes on complete JSON parse
- `convert.ts` enforces DeepSeek invariants: tool messages must follow matching assistant tool_calls
- Orphan tool results (no matching open tool_call_id) are dropped with a warning, not sent to API
- `sanitize.ts` strips unsupported JSON Schema keywords (anyOf/oneOf/allOf) and fixes non-conforming function names
- **Tool-name round-trip:** names are sanitized to DeepSeek's charset before sending (`request.ts` builds a sanitized→original `toolNameMap` on `PreparedRequest`). The model echoes the sanitized name, but the host routes tool calls by the *original* name, so `stream.ts` translates back via the map when emitting the `LanguageModelToolCallPart`. The reasoning-cache fingerprint deliberately keys on the sanitized (wire) name on both the write side (`stream.ts`) and the read side (`convert.ts` re-sanitizes the historical name) so multi-turn cache hits survive. No-op for already-valid names.
- `LanguageModelChatToolMode.Required` maps to a named `tool_choice` for a single tool and the `"required"` literal for several. DeepSeek rejects both forms in thinking mode with a 400, so a request that forces a tool call is always sent with `thinking: { type: 'disabled' }`, even on a `(thinking)` variant (logged as `[req] host requires a tool call …`)

### Request Classification (utility flows)

Copilot Chat fires many small auxiliary requests against the active model — chat titles, commit messages, branch names, rename suggestions, prompt categorization. `request-kind.ts` detects these by their distinctive system-prompt fragments (and the absence of tools — the real agentic loop always passes tools). When a `(thinking)` variant is the active model and such a flow is detected, `request.ts` forces `thinking: { type: 'disabled' }` so reasoning tokens aren't burned on trivial work. Gated to the official base URL (a proxy may map models differently) and to the `deepseek-pilot.optimizeUtilityRequests` setting (default on, so it's killable). It logs `[req] utility flow detected …` whenever it fires, so a false positive is visible in the output channel. The marker list is heuristic — Copilot's internal prompts aren't a public contract — but a miss only costs a few wasted tokens and a false positive only ever drops reasoning from a Copilot helper flow (which doesn't need it). Mirrors the same optimization in both upstream prior-art projects.

## Model Variants

| ID | maxInputTokens | maxOutputTokens | Thinking | Native vision |
| --- | --- | --- | --- | --- |
| `deepseek-flash::thinking` | 655,360 | 393,216 | yes | yes |
| `deepseek-flash` | 983,040 | 65,536 | no | yes |
| `deepseek-v4-pro::thinking` | 655,360 | 393,216 | yes | no |
| `deepseek-v4-pro` | 983,040 | 65,536 | no | no |

The Flash pair targets DeepSeek's flagship **V4.1 Flash** (`deepseek-flash`, 2026-09), which is natively multimodal — it absorbed the experimental `deepseek-v4-flash-vision-exp` model that briefly existed as a separate pair in this extension (v0.6.0-v0.7.1). The Pro pair targets `deepseek-v4-pro` (DeepSeek-V4-Pro-0813), which remains its own model at its own price: DeepSeek had announced routing it to V4.1 Flash from 2026-09-14, then withdrew that and kept serving Pro "with the billing method remaining unchanged" ([change log](https://api-docs.deepseek.com/updates)). Pro stays `nativeVision: false` — the Pro API rejects image parts, so images ride the describe-and-replace proxy there.

DeepSeek exposes a **1M-token shared window** (input + output ≤ 1,048,576) with a 384K max-output ceiling, per [the pricing page](https://api-docs.deepseek.com/quick_start/pricing). The thinking variants reserve the full 393,216-token output so a long reasoning chain can't be silently truncated (leaving 655,360 input); the non-thinking variants reserve 64K and keep 983,040 for input. Both API models are sent via `getApiModelId`; the legacy `deepseek-chat` / `deepseek-reasoner` IDs were retired on 2026-07-24, and the later `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` IDs are retired-but-routed (DeepSeek serves them with V4.1 Flash at Flash pricing), so the extension targets the live IDs directly.

All four variants share `category: { label: 'DeepSeek' }` so they appear under one collapsible row in the model picker. Each declares `capabilities: { imageInput: true, toolCalling: 128 }` (128 = `MAX_TOOLS_PER_REQUEST` in [consts.ts](src/consts.ts) — matches the DeepSeek API cap). Thinking variants additionally expose a `configurationSchema` for the per-model "Thinking Effort" picker (`low` / `high` / `max`, of which `high` is the API default; the V4.1 API also accepts `none`, which is not exposed — a non-thinking variant already covers it — and aliases `minimal`/`medium`/`xhigh` onto the canonical values). Each also carries non-public `inputCost` / `outputCost` / `cacheCost` strings (from `priceFields` in [pricing.ts](src/pricing.ts)) so DeepSeek's prices render in Copilot's native cost slots; hosts that don't read them ignore them, and the `detail` string carries the same numbers as a visible fallback.

### Peak / Off-Peak Pricing

[pricing.ts](src/pricing.ts) is the single source of truth for rates — both the picker hints and `BalanceTracker`'s cost estimate read it. DeepSeek bills on a time-of-day schedule: peak is 01:00-04:00 and 06:00-10:00 UTC **Monday-Friday** (the zh-cn page states the identical window as 周一至周五 09:00-12:00 / 14:00-18:00 Beijing time), and everything else — the 04:00-06:00 UTC gap between the windows, weekday nights, and entire weekends — is off-peak at exactly half the peak rate. The weekday restriction arrived with the V4.1 Flash card (2026-09); the tier check tests `getUTCDay()`, which is exact because both peak windows sit inside 01:00-10:00 UTC where the UTC and Beijing calendar days coincide.

The pricing page also excludes **Chinese public holidays** from peak (不含中国法定节假日): those days bill off-peak in full. China fixes its holidays by annual State Council notice rather than by rule, so `CN_PUBLIC_HOLIDAYS` in pricing.ts copies that notice's date ranges verbatim (inclusive, Beijing calendar) and the tier check compares the UTC date against them inside a peak window, where it equals the Beijing date. Weekend make-up workdays (调休) need no entry, since every weekend hour is off-peak. A year with no ranges falls back to the plain weekday rule, so a missing year only over-reports (bills its holiday weekdays at peak). **Yearly upkeep:** when the State Council publishes the next year's schedule (usually early November), append its seven ranges and a spec for one of its holiday weekdays.

The V4.1 Flash card also cut Flash rates below the V4 figures (peak cache-miss $0.44 to $0.30, output $1.32 to $1.20). It originally scheduled V4 Pro's requests to be routed to V4.1 Flash and billed at the Flash price from 2026-09-14; v0.8.0 date-gated that switch in `getRates`. DeepSeek then withdrew the routing and kept Pro on its own rates, so the gate is gone and Pro always bills its own row.

Only the peak column is stored; off-peak is derived by halving, which is lossless in binary floating point and matches the published off-peak column cell-for-cell. Because the two tiers differ by 2x, prices are resolved at display time rather than at module load — `toChatInfo` stamps the rate in force on each picker query and names the tier in both the `detail` line and the tooltip, so a long-running window can't keep quoting a stale number. `MODELS` therefore carries a static `detailPrefix` ("Pro · thinking") and the rate is appended live.

This replaced the flat rate card the extension shipped through v0.4.3. The peak/off-peak switch was a genuine price increase, not a relabelled discount — the off-peak column sits above every previous rate — so no fallback to the old figures is kept.

## Build & Package

```bash
npm install              # Install dependencies
npm run compile          # Clean + tsc
npm run watch            # Clean + tsc --watch
npm run lint             # npx oxlint
npm test                 # vitest run
npm run format           # npx oxfmt --write src/
npm run package          # Full clean build + VSIX → dist/
npm run publish          # npx @vscode/vsce publish
```

## Conventions

- **Author identity** is `setsey <k.ganenkov@gmail.com>` (configured in local git). Single authorship — no co-author trailers.
- **Before committing**, `npm run compile`, `npm run lint`, and `npm test` must all be green (0 TS errors, 0 lint findings, all vitest specs passing). `vscode` is aliased to `test/vscode-mock.ts` — extend that stub when a newly-tested module reaches a part of the host API it doesn't cover yet.
- **One source of truth for the version**: `package.json` `"version"`. `CHANGELOG.md`'s top entry mirrors it; bump them together.
- **Comments explain WHY, not WHAT.** Skip docstrings that restate the function name; comment a non-obvious constraint, a host-API quirk, or a subtle invariant (the duck-typing note in `tokens.ts` is the model).
- **No emojis in prose / markdown / JSON.** UI strings literally rendered to a user are the only exception.
- **One feature batch per commit** — keep tightly-coupled changes together rather than fanning into partial commits.

## Host Integration Notes

### Built-in Chat View Context Widget (VS Code 1.120+)

The long-standing zero-usage bug ([microsoft/vscode#313458](https://github.com/microsoft/vscode/issues/313458), #309207, #314722) was fixed in VS Code 1.120. The built-in chat-view widget now reads:

1. `provideTokenCount` for the prompt-size estimate while the user is typing.
2. `LanguageModelDataPart.json(usage, 'usage')` — emitted by `stream.ts` once DeepSeek's `usage` chunk arrives — for the post-turn actual count. The bundled Copilot Chat BYOK consumer matches on the literal MIME `"usage"` and requires the JSON to carry `prompt_tokens`, `completion_tokens`, and `total_tokens` as numbers; DeepSeek's usage chunk satisfies all three natively. It then normalizes `prompt_tokens_details.cached_tokens` with a `?? 0` fallback — DeepSeek never sends that field (it reports `prompt_cache_hit_tokens` instead), so `toHostUsage` in `stream.ts` maps one onto the other. Without that mapping the host's cached-token readout stays pinned at 0 even on a full prefix-cache hit.

Re-verify these against the bundle when a host release lands: the consumer lives in `<install>/<commit-prefix>/resources/app/extensions/copilot/dist/extension.js` (minified — grep for `prompt_tokens`). The MIME strings come from one enum: `cache_control`, `stateful_marker`, `thinking`, `context_management`, `phase_data`, `usage`. Last verified against **Copilot Chat 0.65.0, bundled with VS Code 1.137.0** (2026-09-10): enum unchanged, validator unchanged (the three token fields as numbers), and the consumer now additionally clamps every count with `Math.max(0, ...)`. Since 0.65 the same consumer also routes `LanguageModelThinkingPart` instances from BYOK providers into the chat view's reasoning lane, and the picker cost slots gained optional `cacheWriteCost` / `longContext*` fields (DeepSeek bills neither separately, so the three we send remain the right set).

The extension's `BalanceTracker` status bar widget is still the home for the DeepSeek-specific cache-hit % and KV-cache-aware compaction advice that the built-in widget can't show.

### Utility Models (Copilot Chat 1.121)

`src/utility-model.ts` writes either `chat.utilityModel` or `chat.utilitySmallModel` with the canonical `vendor/id` of a chosen DeepSeek variant. Flash is the default suggestion — utility flows (titles, summaries, intents) get no benefit from extended thinking and Flash's pricing makes them effectively free. Copilot Chat 0.65 still parses both settings as `${vendor}/${id}` (verified in the bundle) and adds a fallback setting, `chat.byokUtilityModelDefault` (`none` / `mainAgent` / `copilot`, default `copilot`), that decides where utility flows go when a BYOK model is the main agent and no explicit utility model is configured — an unset slot no longer errors for signed-in Copilot users, but the explicit settings this extension writes always win.

### The `engines.vscode` Floor

`engines.vscode` and `@types/vscode` are both deliberately held at **1.120.0** even though VS Code ships 1.137. The stable `vscode.d.ts` is unchanged between 1.120 and 1.137 (the newest typings npm publishes, re-diffed 2026-09-10) apart from doc-comment edits — a `CompletionItemKind` comment reorder, an inlay-hint ordering note, and a parameter rename in prose — so nothing in the provider API has moved. Raising the floor would only shrink the installable base for zero API gain — `@types/vscode` must stay `<=` `engines.vscode` or `vsce` rejects the package, so the two move together or not at all. Diff the typings before assuming a bump is needed.

### Streaming Reasoning

`languageModelThinkingPart` is still a **proposed** API in 1.137 (checked against the 1.137.0 stable typings, 2026-09-10), and the Marketplace won't accept an extension that declares `enabledApiProposals`. So `stream.ts` feature-detects `vscode.LanguageModelThinkingPart` at runtime and falls back to a one-shot `Thinking...` text marker — which is the path that actually runs for published builds. Keep the detection: Copilot Chat 0.65's BYOK consumer already forwards thinking parts to the chat view's reasoning lane, so the moment the API is finalized the streaming-reasoning path lights up with no code change.

### Debug Logging

`provideTokenCount` first invocation is logged at `info` level to confirm Copilot Chat is calling it. Set `deepseek-pilot.debug: true` for full diagnostic output including cache traces and message summaries.

## Common Tasks

### Adding a new DeepSeek model variant

1. Add entry to `MODELS` array in `consts.ts` (set `nativeVision` for multimodal models)
2. Route the family in `resolveFamily` in `pricing.ts`; add a `PEAK_RATES` entry (both currencies) only if it bills at genuinely new rates (retired-but-routed legacy ids reuse Flash's)
3. Add a `modelIdOverrides` slot in `package.json` if proxy users may need to remap it
4. Model picker auto-discovers from `provideLanguageModelChatInformation`

### Changing token estimation

- Modify `estimateTokenCount` / `estimatePartChars` in `tokens.ts`
- The `charsPerToken` ratio self-calibrates via EMA from actual API usage (see `stream.ts` → `onCharsPerToken`)
- Remember: parts arrive as plain objects, not class instances — use duck typing

### Debugging 400 errors

1. Enable `deepseek-pilot.debug: true`
2. Check output channel for `diagnostics.ts` cache traces (role sequences, hashes)
3. Validate with `validate.ts` — checks tool_call / tool_result pairing
4. Check `sanitize.ts` — malformed function names or unsupported schema keywords

### Testing vision

**Native path:** pick a V4.1 Flash variant, drop an image into Copilot Chat, and confirm the request carries `image_url` content parts (enable `deepseek-pilot.debug` — the cache-trace snapshot logs a `[image_url:N]` placeholder, never the base64).

**Proxy path:**

1. Pick a text-only variant (Pro). With no `visionModel` setting, the built-in DeepSeek describer is used — the output channel logs `Vision describer: native deepseek-flash`.
2. To test a host-model describer instead: `DeepSeek Pilot: Set Vision Proxy Model` and pick a non-DeepSeek model.
3. Drop an image into Copilot Chat — it is described, cached, and the description is sent to DeepSeek.
4. Check output channel for vision resolution stats

**Tool path:** in agent mode, ask about an image by its path (or reference `#viewImage path/to/shot.png`) — the output channel logs `[tool] viewImage read ...` and the image then follows the native or proxy path per the active variant.
