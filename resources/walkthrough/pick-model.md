# Pick a DeepSeek V4 QA Model

Open Copilot Chat (`Ctrl+Shift+I`) and select a model from the picker:

- **V4 Pro (thinking)**: Complex code review, incident investigation
- **V4 Pro**: Strong, lower latency, no reasoning chain
- **V4 Flash (thinking)**: Cheap extended thinking for analysis
- **V4 Flash**: Cheapest, fastest, simple tasks

If the provider is present but not fully configured yet, open **DeepSeek QA: Manage Provider** from the picker menu or command palette.

Thinking variants also expose a per-model **Thinking Effort** selector with `high` and `max`.

**Vision support:** Drop images into chat. The extension automatically proxies them through a vision-capable model, then sends the text description to DeepSeek.

**Status bar:** Shows session token spend and estimated cost. Run **DeepSeek QA: Refresh Balance** to check your platform balance.
