import vscode from 'vscode';
import { getApiUrl } from './config';

const SECRET_KEY = 'deepseek-pilot.apiKey';
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
      title: vscode.l10n.t('deepseek-pilot.auth.title'),
      prompt: vscode.l10n.t('deepseek-pilot.auth.prompt'),
      password: true,
      value: existing,
      placeHolder: vscode.l10n.t('deepseek-pilot.auth.placeholder'),
      ignoreFocusOut: true,
    });

    if (key === undefined) return false;

    const trimmed = key.trim();
    if (!trimmed) {
      vscode.window.showWarningMessage(vscode.l10n.t('deepseek-pilot.auth.required'));
      return false;
    }

    const failureReason = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t('deepseek-pilot.auth.validating'),
      },
      async () => validateApiKey(trimmed),
    );

    if (failureReason !== null) {
      const choice = await vscode.window.showWarningMessage(
        vscode.l10n.t('deepseek-pilot.auth.failed', failureReason),
        { modal: false },
        vscode.l10n.t('deepseek-pilot.auth.saveAnyway'),
        vscode.l10n.t('deepseek-pilot.auth.cancel'),
      );
      if (choice !== vscode.l10n.t('deepseek-pilot.auth.saveAnyway')) {
        return false;
      }
    }

    await this.context.secrets.store(SECRET_KEY, trimmed);
    vscode.window.showInformationMessage(
      failureReason === null
        ? vscode.l10n.t('deepseek-pilot.auth.saved')
        : vscode.l10n.t('deepseek-pilot.auth.savedNoValidation'),
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
