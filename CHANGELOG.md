# Changelog

All notable changes to **DeepSeek Pilot** are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
