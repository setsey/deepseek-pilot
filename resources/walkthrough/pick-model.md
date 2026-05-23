# Pick a DeepSeek Pilot Model

Open Copilot Chat (`Ctrl+Shift+I`) and select a model from the picker:

- **V4 Pro (thinking)**: Complex code review, incident investigation
- **V4 Pro**: Strong, lower latency, no reasoning chain
- **V4 Flash (thinking)**: Cheap extended thinking for analysis
- **V4 Flash**: Cheapest, fastest, simple tasks

If the provider is present but not fully configured yet, open **DeepSeek Pilot: Manage Provider** from the picker menu or command palette.

Thinking variants also expose a per-model **Thinking Effort** selector with `high` and `max`.

**Vision support:** Drop images into chat. The extension automatically proxies them through a vision-capable model, then sends the text description to DeepSeek.

**Use as utility model:** From **Manage Provider**, pick **Use as Copilot Utility Model** (or the *Small* variant) to route Copilot's background flows — titles, summaries, commit messages, intent detection — through DeepSeek Flash. Cheap, fast, no thinking.

**Status bar:** Shows context-window saturation, session token spend, estimated cost, and platform balance — all in one widget. Hover for the KV-cache-aware compaction guidance.
