# Changelog

All notable changes to **DeepSeek Pilot** are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
