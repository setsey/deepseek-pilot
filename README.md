# DeepSeek V4 QA — VS Code Extension

DeepSeek V4 Pro & Flash models in GitHub Copilot Chat with:

- **Vision proxy** — drop images into chat, auto-described by a vision-capable model
- **Token tracking** — session token counts and estimated cost in the status bar
- **Balance refresh** — fetch DeepSeek platform balance on demand
- **Reasoning cache** — persistent across VS Code restarts
- **4 model variants** — Pro/Flash × thinking/non-thinking
- **Thinking effort** — high/max reasoning depth
- **API key validation** — probes the API before saving

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
| Set API Key | `DeepSeek QA: Set API Key` |
| Clear API Key | `DeepSeek QA: Clear API Key` |
| Set Vision Proxy Model | `DeepSeek QA: Set Vision Proxy Model` |
| Refresh Balance | `DeepSeek QA: Refresh Balance` |
| Clear Session Counter | `DeepSeek QA: Clear Session Counter` |
| Show Cache Stats | `DeepSeek QA: Show Reasoning Cache Stats` |
| Show Logs | `DeepSeek QA: Show Logs` |

## Status Bar

Shows session token count and estimated cost. Tooltip shows cache-hit breakdown and platform balance (after refresh).

## License

MIT
