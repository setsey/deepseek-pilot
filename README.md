# DeepSeek V4 QA — VS Code Extension

DeepSeek V4 Pro & Flash models in GitHub Copilot Chat with:

- **Vision proxy** — drop images into chat, auto-described by a vision-capable model
- **Token tracking** — session token counts and estimated cost in the status bar
- **Balance refresh** — fetch DeepSeek platform balance on demand
- **Reasoning cache** — persistent across VS Code restarts
- **4 model variants** — Pro/Flash × thinking/non-thinking
- **Thinking effort** — high/max reasoning depth
- **Model discoverability** — variants stay visible in the picker even before a key is configured
- **API key validation** — probes the configured endpoint before saving, but can still save proxy tokens

Merges the best of:

- [Vizards/deepseek-v4-for-copilot](https://github.com/Vizards/deepseek-v4-for-copilot) — vision proxy, clean architecture
- [Laurent00TT/deepseek-v4-vscode-chat](https://github.com/Laurent00TT/deepseek-v4-vscode-chat) — token tracking, balance, cache stats

## Install

```bash
git clone local
cd deepseek-v4-qa
npm install
npm run package
```

Then in VS Code: `Extensions` → `...` → `Install from VSIX...` → pick `dist/deepseek-v4-qa-0.1.0.vsix`

Or link directly:

```bash
# Create a symlink from your VS Code extensions folder
mklink /D %USERPROFILE%\.vscode\extensions\konstantyn-ganenkov.deepseek-v4-qa-0.1.0 C:\path\to\deepseek-v4-qa
```

## Commands

| Command | Palette |
| ------- | ------- |
| Manage Provider | `DeepSeek QA: Manage Provider` |
| Set API Key | `DeepSeek QA: Set API Key` |
| Clear API Key | `DeepSeek QA: Clear API Key` |
| Set Vision Proxy Model | `DeepSeek QA: Set Vision Proxy Model` |
| Refresh Balance | `DeepSeek QA: Refresh Balance` |
| Clear Session Counter | `DeepSeek QA: Clear Session Counter` |
| Show Cache Stats | `DeepSeek QA: Show Reasoning Cache Stats` |
| Show Logs | `DeepSeek QA: Show Logs` |

## Model Picker

All four variants remain visible in the Copilot Chat model picker.

- Thinking variants expose a per-model `Thinking Effort` control with `high` and `max`.
- If the provider is visible but not fully configured yet, use `Manage Provider` from the picker or command palette.

## Status Bar

Shows session token count and estimated cost. Tooltip shows cache-hit breakdown, current reasoning effort, and platform balance after refresh.

## Configuration

- `deepseek-qa.reasoningEffort`: default effort for `(thinking)` variants
- `deepseek-qa.modelIdOverrides`: remap API model IDs for DeepSeek-compatible proxy endpoints
- `deepseek-qa.baseUrl`: switch between DeepSeek and compatible gateways

## License

MIT
