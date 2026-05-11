import vscode from 'vscode';
import { logger } from './logger';

const SECRET_KEY = 'deepseek-qa.apiKey';
const VALIDATE_URL = 'https://api.deepseek.com/v1/models';

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
      prompt: 'Paste your DeepSeek API key (starts with sk-)',
      password: true,
      value: existing,
      placeHolder: 'sk-...',
      validateInput: async (value) => {
        if (!value.trim()) return 'API key is required';
        if (!value.startsWith('sk-')) return 'API key should start with sk-';
        const reason = await validateApiKey(value.trim());
        if (reason) return reason;
        return null;
      },
    });

    if (!key) return false;
    await this.context.secrets.store(SECRET_KEY, key.trim());
    vscode.window.showInformationMessage('DeepSeek API key saved and validated.');
    return true;
  }

  async deleteApiKey(): Promise<void> {
    await this.context.secrets.delete(SECRET_KEY);
  }
}

async function validateApiKey(apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(VALIDATE_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) return null;
    if (res.status === 401) return 'Invalid API key (401 Unauthorized)';
    if (res.status === 402) return 'Insufficient balance (402)';
    if (res.status === 429) return 'Rate limited (429) — try again in a moment';
    return `Unexpected ${res.status} ${res.statusText}`;
  } catch (e) {
    return `Network error: ${e instanceof Error ? e.message : String(e)}`;
  }
}
