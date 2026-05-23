---
name: deepseek-pilot-extension
description: Comprehensive knowledge about the DeepSeek Pilot VS Code extension project — architecture, patterns, build commands, host integration notes, and DeepSeek API constraints. Use when working on this extension: adding models, debugging 400 errors, fixing token counting, modifying vision proxy, or understanding the LanguageModelChatProvider implementation.
---

# DeepSeek Pilot Extension Skill

Expert knowledge about this VS Code extension that registers DeepSeek V4 models in Copilot Chat.

## Quick Reference

| Task | File(s) |
|------|---------|
| Add a new model variant | `src/consts.ts` (MODELS), `src/provider/balance.ts` (PRICING) |
| Fix token counting | `src/provider/tokens.ts` — use duck typing, NOT instanceof |
| Debug 400 errors | Enable `deepseek-pilot.debug`, check `src/provider/diagnostics.ts` output |
| Change vision proxy | `src/provider/vision/model.ts`, `src/provider/vision/resolve.ts` |
| Modify tool handling | `src/provider/sanitize.ts` (schema), `src/provider/stream.ts` (SSE) |
| Adjust cost estimation | `src/provider/balance.ts` (pricing, discount logic) |
| Wire utility-model setting | `src/utility-model.ts` (writes `chat.utilityModel{,Small}`) |

## Architecture (see AGENTS.md for full details)

```text
src/
├── extension.ts          # Activation, commands, status bar, migration shim
├── auth.ts               # API key via secrets API
├── config.ts             # Workspace config readers
├── consts.ts             # Models, MIME types, USAGE_MIME_TYPE, MAX_TOOLS_PER_REQUEST
├── types.ts              # DSUsage, DSBalance, OpenAI types
├── utility-model.ts      # chat.utilityModel / chat.utilitySmallModel wiring
└── provider/
    ├── index.ts          # DeepSeekChatProvider (main LM provider)
    ├── balance.ts        # BalanceTracker (cost, status bar)
    ├── cache.ts          # ReasoningCache (persistent across restarts)
    ├── convert.ts        # VS Code messages → DeepSeek format
    ├── stream.ts         # SSE streaming, tool call buffering, usage emission
    ├── tokens.ts         # estimateTokenCount (duck-typed parts)
    ├── validate.ts       # Pre-flight message validation
    ├── sanitize.ts       # Tool schema sanitization
    └── vision/           # Image proxy → text descriptions
```

## Critical Patterns

### 1. Duck Typing in tokens.ts (MUST FOLLOW)

`estimatePartChars()` uses property checks (`mimeType`, `callId`, `value`), NEVER `instanceof`. Copilot Chat calls `provideTokenCount` across VS Code's API proxy boundary — parts lose their class prototype. `instanceof` will always return false and token count will be 0.

Convert.ts and validate.ts CAN use `instanceof` — they run inside the extension process.

### 2. Reasoning Cache for Thinking Mode

DeepSeek thinking mode requires `reasoning_content` on EVERY assistant turn after tool_calls are emitted (missing = 400 error). The `ReasoningCache` provides:

- Cache hit → reuse original reasoning
- Cache miss → `""` empty string fallback (prevents 400)
- Persists across VS Code restarts via `globalState`

### 3. DeepSeek API Constraints

- Tool function names: `^[a-zA-Z][a-zA-Z0-9_-]*$`, ≤64 chars
- No `anyOf`/`oneOf`/`allOf` in JSON schemas
- Tool messages must follow matching assistant tool_calls
- Orphan tool results are dropped (not sent to API)
- Max tools per request: 128 (declared via `capabilities.toolCalling`)

### 4. Vision Proxy Flow

1. User drops image in chat
2. Image described by separate vision-capable model (configured via `Set Vision Proxy Model`)
3. Description cached by data hash (SHA-256)
4. Text description sent to DeepSeek (text-only model)

### 5. Utility Model Wiring (Copilot Chat 1.121)

`src/utility-model.ts` writes either `chat.utilityModel` or `chat.utilitySmallModel` with the value `deepseek-pilot/<model-id>`. This routes Copilot's background flows (titles, summaries, commit messages, intent detection) through the chosen DeepSeek variant. Flash is the suggested default — utility flows get no benefit from extended thinking, and Flash's pricing makes them effectively free.

## Build Commands

```bash
npm run compile    # Clean + tsc → out/
npm run package    # Full build + vsce → dist/*.vsix
npm run lint       # oxlint
npm run format     # oxfmt --write src/
```

## Host Integration Note: BYOK Context Window Widget

VS Code 1.120 fixed the long-standing zero-usage bug (microsoft/vscode#313458, #309207, #314722). The chat-view widget now reads `provideTokenCount` for the pre-send estimate and `LanguageModelDataPart.json(usage, 'application/vnd.llm.usage+json')` (emitted by `stream.ts`) for the post-turn actual count. The extension's own `BalanceTracker` status bar widget still owns the DeepSeek-specific signals — cache-hit %, KV-cache-aware compaction advice — that the built-in widget cannot show.

## File Map by Concern

**When changing how models appear in picker**: `consts.ts` (MODELS), `provider/models.ts` (toChatInfo)

**When changing API request format**: `provider/request.ts`, `provider/convert.ts`

**When changing streaming behavior**: `provider/stream.ts`

**When changing token estimation**: `provider/tokens.ts` (remember duck typing!)

**When changing cost display**: `provider/balance.ts`

**When debugging why something isn't sent to DeepSeek**: `provider/validate.ts`, `provider/sanitize.ts`, `provider/convert.ts`

**When changing vision/image handling**: `provider/vision/`

**When changing auth or migration**: `auth.ts`, `extension.ts` (migration shim at activation)
