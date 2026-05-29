# DeepSeek Pilot — Developer Guide

## Overview

VS Code extension that registers DeepSeek V4 models (Pro/Flash × thinking/non-thinking) as `LanguageModelChatProvider` for GitHub Copilot Chat. Merges vision proxy from [deepseek-v4-for-copilot](https://github.com/Vizards/deepseek-v4-for-copilot) and balance/token tracking from [deepseek-v4-vscode-chat](https://github.com/Laurent00TT/deepseek-v4-vscode-chat).

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
├── json.ts               # tryParseJson, safeJsonStringify
├── logger.ts             # Output channel logger (debug gated by setting)
├── types.ts              # OpenAI/DeepSeek API types (DSBalance, DSUsage, etc.)
├── utility-model.ts      # `chat.utilityModel` wiring (Copilot Chat 1.121 utility-model slots)
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

### Vision Proxy

- DeepSeek models are text-only; images are described by a separate vision-capable model
- Cache: primary by `(mime + dataHash + visionModel + prompt`), secondary by `dataHash`
- Single-flight deduplication: concurrent same-image lookups share one proxy call
- `provideTokenCount` reads cached descriptions via `dataHash` to estimate image tokens

### Tool Call Handling

- `stream.ts` buffers tool call deltas by `index`, flushes on complete JSON parse
- `convert.ts` enforces DeepSeek invariants: tool messages must follow matching assistant tool_calls
- Orphan tool results (no matching open tool_call_id) are dropped with a warning, not sent to API
- `sanitize.ts` strips unsupported JSON Schema keywords (anyOf/oneOf/allOf) and fixes non-conforming function names

## Model Variants

| ID | maxInputTokens | maxOutputTokens | Thinking |
| --- | --- | --- | --- |
| `deepseek-v4-pro::thinking` | 720,896 | 262,144 | yes |
| `deepseek-v4-pro` | 917,504 | 65,536 | no |
| `deepseek-v4-flash::thinking` | 720,896 | 262,144 | yes |
| `deepseek-v4-flash` | 917,504 | 65,536 | no |

All four variants share `category: { label: 'DeepSeek V4' }` so they appear under one collapsible row in the model picker. Each declares `capabilities: { imageInput: true, toolCalling: 128 }` (128 = `MAX_TOOLS_PER_REQUEST` in [consts.ts](src/consts.ts) — matches the DeepSeek API cap). Thinking variants additionally expose a `configurationSchema` for the per-model "Thinking Effort" picker (`high` / `max`).

## Build & Package

```bash
npm install              # Install dependencies
npm run compile          # Clean + tsc
npm run watch            # Clean + tsc --watch
npm run lint             # npx oxlint
npm run format           # npx oxfmt --write src/
npm run package          # Full clean build + VSIX → dist/
npm run publish          # npx @vscode/vsce publish
```

## Conventions

- **Author identity** is `setsey <k.ganenkov@gmail.com>` (configured in local git). Single authorship — no co-author trailers.
- **Before committing**, `npm run compile` and `npm run lint` must both be green (0 TS errors, 0 lint findings). There are no tests yet.
- **One source of truth for the version**: `package.json` `"version"`. `CHANGELOG.md`'s top entry mirrors it; bump them together.
- **Comments explain WHY, not WHAT.** Skip docstrings that restate the function name; comment a non-obvious constraint, a host-API quirk, or a subtle invariant (the duck-typing note in `tokens.ts` is the model).
- **No emojis in prose / markdown / JSON.** UI strings literally rendered to a user are the only exception.
- **One feature batch per commit** — keep tightly-coupled changes together rather than fanning into partial commits.

## Host Integration Notes

### Built-in Chat View Context Widget (VS Code 1.120+)

The long-standing zero-usage bug ([microsoft/vscode#313458](https://github.com/microsoft/vscode/issues/313458), #309207, #314722) was fixed in VS Code 1.120. The built-in chat-view widget now reads:

1. `provideTokenCount` for the prompt-size estimate while the user is typing.
2. `LanguageModelDataPart.json(usage, 'usage')` — emitted by `stream.ts` once DeepSeek's `usage` chunk arrives — for the post-turn actual count. The bundled Copilot Chat BYOK consumer (in `f6cfa2ea24/resources/app/extensions/copilot/`) matches on the literal MIME `"usage"` and requires the JSON to carry `prompt_tokens`, `completion_tokens`, and `total_tokens` as numbers; DeepSeek's usage chunk satisfies all three natively.

The extension's `BalanceTracker` status bar widget is still the home for the DeepSeek-specific cache-hit % and KV-cache-aware compaction advice that the built-in widget can't show.

### Utility Models (Copilot Chat 1.121)

`src/utility-model.ts` writes either `chat.utilityModel` or `chat.utilitySmallModel` with the canonical `vendor/id` of a chosen DeepSeek variant. Flash is the default suggestion — utility flows (titles, summaries, intents) get no benefit from extended thinking and Flash's pricing makes them effectively free.

### Debug Logging

`provideTokenCount` first invocation is logged at `info` level to confirm Copilot Chat is calling it. Set `deepseek-pilot.debug: true` for full diagnostic output including cache traces and message summaries.

## Common Tasks

### Adding a new DeepSeek model variant

1. Add entry to `MODELS` array in `consts.ts`
2. Add pricing tier in `balance.ts` → `PRICING` object
3. Model picker auto-discovers from `provideLanguageModelChatInformation`

### Changing token estimation

- Modify `estimateTokenCount` / `estimatePartChars` in `tokens.ts`
- The `charsPerToken` ratio self-calibrates via EMA from actual API usage (see `stream.ts` → `onCharsPerToken`)
- Remember: parts arrive as plain objects, not class instances — use duck typing

### Debugging 400 errors

1. Enable `deepseek-pilot.debug: true`
2. Check output channel for `diagnostics.ts` cache traces (role sequences, hashes)
3. Validate with `validate.ts` — checks tool_call / tool_result pairing
4. Check `sanitize.ts` — malformed function names or unsupported schema keywords

### Testing vision proxy

1. Configure a vision-capable model: `DeepSeek Pilot: Set Vision Proxy Model`
2. Drop an image into Copilot Chat
3. The image is described by the proxy model, cached, and the description is sent to DeepSeek
4. Check output channel for vision resolution stats
