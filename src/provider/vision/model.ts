import vscode from 'vscode';
import { getVisionModelSetting } from '../../config';
import { logger } from '../../logger';

/**
 * Creates a vision model getter. Returns the user-configured vision proxy
 * model as a LanguageModelChat. The resolved model is cached until settings change.
 */
export function createVisionModelGetter(): {
  get: () => Promise<vscode.LanguageModelChat | null>;
  reset: () => void;
} {
  let cached: vscode.LanguageModelChat | null | undefined;

  return {
    get: async () => {
      if (cached !== undefined) return cached;

      const settingId = getVisionModelSetting().trim();
      if (!settingId) {
        cached = null;
        return null;
      }

      const models = await vscode.lm.selectChatModels({ id: settingId });
      cached = models[0] ?? null;

      if (cached) {
        logger.info(`Vision proxy model: ${cached.id}`);
      } else {
        logger.warn(`Vision proxy model not found: ${settingId}`);
      }

      return cached;
    },

    reset: () => {
      cached = null;
    },
  };
}

const KNOWN_VISION_MODELS = [
  { id: 'copilot:gpt-4o', label: 'GPT-4o', description: 'OpenAI vision model via Copilot' },
  { id: 'copilot:claude-sonnet-4', label: 'Claude Sonnet 4', description: 'Anthropic vision model via Copilot' },
  { id: 'copilot:gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Google vision model via Copilot' },
];

export async function setVisionProxyModel(): Promise<void> {
  const picked = await vscode.window.showQuickPick(
    KNOWN_VISION_MODELS.map((m) => ({
      label: m.label,
      description: m.description,
      detail: m.id,
    })),
    {
      title: 'Select Vision Proxy Model',
      placeHolder: 'Choose a model to describe images before sending to DeepSeek',
    },
  );

  if (!picked) return;

  const model = KNOWN_VISION_MODELS.find((m) => m.label === picked.label);
  if (!model) return;

  await vscode.workspace
    .getConfiguration('deepseek-qa')
    .update('visionModel', model.id, vscode.ConfigurationTarget.Global);

  vscode.window.showInformationMessage(`Vision proxy model set to: ${model.label}`);
}
