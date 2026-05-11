import vscode from 'vscode';
import { getVisionModelSetting } from '../../config';
import { logger } from '../../logger';

/**
 * Lazy-resolved vision proxy model. Cached after the first successful
 * lookup and invalidated when the user changes the `deepseek-qa.visionModel`
 * setting (the provider listens to `onDidChangeConfiguration` and calls
 * `reset()`).
 */
export function createVisionModelGetter(): {
  get: () => Promise<vscode.LanguageModelChat | null>;
  reset: () => void;
} {
  let cached: vscode.LanguageModelChat | null | undefined;
  let pending: Promise<vscode.LanguageModelChat | null> | undefined;

  return {
    get: async () => {
      if (cached !== undefined) return cached;
      if (pending) return pending;

      pending = (async () => {
        const settingId = getVisionModelSetting().trim();
        if (settingId) {
          const models = await vscode.lm.selectChatModels({ id: settingId });
          if (models[0]) {
            logger.info(`Vision proxy model: ${models[0].id}`);
            cached = models[0];
            return models[0];
          }
          logger.warn(`Configured vision proxy model not found: ${settingId}`);
        }

        // Auto-fallback: pick the first non-DeepSeek vision-capable model
        // from any registered vendor (Copilot built-ins, custom providers, etc.).
        try {
          const all = await vscode.lm.selectChatModels();
          const candidate = all.find(
            (m) => m.vendor !== 'deepseek-qa' && m.vendor !== 'deepseek' && m.vendor !== 'deepseek-v4',
          );
          if (candidate) {
            logger.info(`Vision proxy auto-detected: ${candidate.id}`);
            cached = candidate;
            return candidate;
          }
        } catch (e) {
          logger.warn('Vision auto-detect failed', e);
        }

        cached = null;
        return null;
      })();

      try {
        return await pending;
      } finally {
        pending = undefined;
      }
    },

    reset: () => {
      cached = undefined;
      pending = undefined;
    },
  };
}

/**
 * Let the user pick a vision proxy model from all registered chat models
 * (excluding our own DeepSeek vendors). Persists the choice to settings.
 */
export async function setVisionProxyModel(): Promise<void> {
  const allModels = await vscode.lm.selectChatModels();
  const candidates = allModels.filter(
    (m) => m.vendor !== 'deepseek-qa' && m.vendor !== 'deepseek' && m.vendor !== 'deepseek-v4',
  );

  if (candidates.length === 0) {
    vscode.window.showInformationMessage(
      'No vision-capable models found. Sign in to GitHub Copilot Chat to enable vision proxy.',
    );
    return;
  }

  const currentId = getVisionModelSetting().trim();

  const items = candidates.map((m) => ({
    label: m.id,
    description: m.vendor,
    detail: m.id === currentId ? 'Currently selected' : undefined,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Pick a model to describe images before sending them to DeepSeek',
    matchOnDescription: true,
  });

  if (!picked) return;

  await vscode.workspace
    .getConfiguration('deepseek-qa')
    .update('visionModel', picked.label, vscode.ConfigurationTarget.Global);

  vscode.window.showInformationMessage(`Vision proxy model set to: ${picked.label}`);
}
