import vscode from 'vscode';
import { getApiUrl } from './config';

const SECRET_KEY = 'deepseek-qa.apiKey';
const VALIDATION_PATHS = ['models', 'v1/models'];

export class AuthManager {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async hasApiKey(): Promise<boolean> {
    const key = await this.context.secrets.get(SECRET_KEY);
    return !!key;
  }

  async getApiKey(): Promise<string | undefined> {
    return this.context.secrets.get(SECRET_KEY);
  }

  async promptForApiKey(): Promise<boolean> {
    const existing = await this.context.secrets.get(SECRET_KEY);
    const key = await vscode.window.showInputBox({
      title: 'DeepSeek API Key',
      prompt: 'Paste your DeepSeek API key or compatible proxy bearer token',
      password: true,
      value: existing,
      placeHolder: 'sk-... or your proxy token',
      ignoreFocusOut: true,
    });

    if (key === undefined) return false;

    const trimmed = key.trim();
    if (!trimmed) {
      vscode.window.showWarningMessage('API key is required.');
      return false;
    }

    const failureReason = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Validating DeepSeek API key…',
      },
      async () => validateApiKey(trimmed),
    );

    if (failureReason !== null) {
      const choice = await vscode.window.showWarningMessage(
        `API key validation failed: ${failureReason}`,
        { modal: false },
        'Save anyway',
        'Cancel',
      );
      if (choice !== 'Save anyway') {
        return false;
      }
    }

    await this.context.secrets.store(SECRET_KEY, trimmed);
    vscode.window.showInformationMessage(
      failureReason === null
        ? 'DeepSeek API key validated and saved.'
        : 'DeepSeek API key saved without successful validation.',
    );
    return true;
  }

  async deleteApiKey(): Promise<void> {
    await this.context.secrets.delete(SECRET_KEY);
  }
}

async function validateApiKey(apiKey: string): Promise<string | null> {
  let lastFailure: string | null = null;

  for (const url of new Set(VALIDATION_PATHS.map((path) => getApiUrl(path)))) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (res.ok) return null;
      if (res.status === 404) {
        lastFailure = `Validation endpoint not available at ${url}`;
        continue;
      }
      if (res.status === 401) return 'Invalid API key (401 Unauthorized)';
      if (res.status === 402) return 'Insufficient balance (402)';
      if (res.status === 429) return 'Rate limited (429) — try again in a moment';
      return `Unexpected ${res.status} ${res.statusText}`;
    } catch (e) {
      lastFailure = `Network error: ${e instanceof Error ? e.message : String(e)}`;
      break;
    }
  }

  return lastFailure ?? 'Unable to validate API key';
}
