---
name: deepseek-v4-qa-extension
description: Comprehensive knowledge about the DeepSeek V4 QA VS Code extension project — architecture, patterns, build commands, known issues, and API constraints. Use when working on this extension: adding models, debugging 400 errors, fixing token counting, modifying vision proxy, or understanding the LanguageModelChatProvider implementation.
---

# DeepSeek V4 QA Extension Skill

Expert knowledge about this VS Code extension that registers DeepSeek V4 models in Copilot Chat.

## Quick Reference

| Task | File(s) |
|------|---------|
| Add a new model variant | `src/consts.ts` (MODELS), `src/provider/balance.ts` (PRICING) |
| Fix token counting | `src/provider/tokens.ts` — use duck typing, NOT instanceof |
| Debug 400 errors | Enable `deepseek-qa.debug`, check `src/provider/diagnostics.ts` output |
| Change vision proxy | `src/provider/vision/model.ts`, `src/provider/vision/resolve.ts` |
| Modify tool handling | `src/provider/sanitize.ts` (schema), `src/provider/stream.ts` (SSE) |
| Adjust cost estimation | `src/provider/balance.ts` (pricing, discount logic) |

## Architecture (see AGENTS.md for full details)

```
src/
├── extension.ts          # Activation, commands, status bar
├── auth.ts               # API key via secrets API
├── config.ts             # Workspace config readers
├── consts.ts             # Models, MIME types, USAGE_MIME_TYPE
├── types.ts              # DSUsage, DSBalance, OpenAI types
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

### 4. Vision Proxy Flow

1. User drops image in chat
2. Image described by separate vision-capable model (configured via `Set Vision Proxy Model`)
3. Description cached by data hash (SHA-256)
4. Text description sent to DeepSeek (text-only model)

## Build Commands

```bash
npm run compile    # Clean + tsc → out/
npm run package    # Full build + vsce → dist/*.vsix
npm run lint       # oxlint
npm run format     # oxfmt --write src/
```

## Known Issue: Context Window Shows 0

Copilot Chat bug (microsoft/vscode#309207, #314722) — hardcodes zero usage for third-party providers. `provideTokenCount` works (used for prompt budgeting), but display widget reads hardcoded zeros. Extension already emits `LanguageModelDataPart.json(usage, 'application/vnd.llm.usage+json')` for forward compatibility. Real usage shown in status bar via BalanceTracker.

## File Map by Concern

**When changing how models appear in picker**: `consts.ts` (MODELS), `provider/models.ts` (toChatInfo)

**When changing API request format**: `provider/request.ts`, `provider/convert.ts`

**When changing streaming behavior**: `provider/stream.ts`

**When changing token estimation**: `provider/tokens.ts` (remember duck typing!)

**When changing cost display**: `provider/balance.ts`

**When debugging why something isn't sent to DeepSeek**: `provider/validate.ts`, `provider/sanitize.ts`, `provider/convert.ts`

**When changing vision/image handling**: `provider/vision/`

**When changing auth**: `auth.ts`
